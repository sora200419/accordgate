import 'dotenv/config';
import crypto from 'node:crypto';
import dns from 'node:dns/promises';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { AccountAddress, ContractAddress } from '@concordium/web-sdk';
import { ConcordiumGRPCNodeClient, credentials } from '@concordium/web-sdk/nodejs';
import express from 'express';
import { createServer as createViteServer } from 'vite';
import { AccountNotFoundError, createAuth, parseOwnerAccounts } from './server/auth.ts';
import type { AccountInfoLookup } from './server/auth.ts';
import { createAgentReplayGuard, DEFAULT_PER_AGENT_CAP } from './server/agentFreshness.ts';
import type { AgentReplayGuard } from './server/agentFreshness.ts';
import {
  computeAgentCardHash,
  generateSimulatedTxHash,
  generateZkpCommitment,
  sha256Hex,
  signAgentRequest,
  verifyAgentSignature,
} from './server/crypto.ts';
import {
  appendAuditEntryToDb,
  collectDescendantAgents,
  createNewAgentRecord,
  loadDatabase,
  resetDatabase,
  saveDatabase,
  SIMULATED_SPONSOR,
  verifyAuditHashChain,
} from './server/store.ts';
import type {
  AgentRecord,
  AgentStatus,
  AuditEntry,
  GatePolicy,
  GatewayDatabase,
  GatewayProtocol,
  OnchainAnchorRecord,
  PipelineStepTrace,
  SandboxClaimInput,
  WebhookConfig,
  WebhookEventType,
  X402Invoice,
} from './server/types.ts';

const PORT = 3000;
const TESTNET_GRPC_HOST = 'grpc.testnet.concordium.com';
const TESTNET_GRPC_PORT = 20000;

const rateLimitBuckets = new Map<string, number[]>();

function createTestnetGrpcClient() {
  return new ConcordiumGRPCNodeClient(TESTNET_GRPC_HOST, TESTNET_GRPC_PORT, credentials.createSsl(), {
    timeout: 5000,
  });
}

function recordAndCheckRateLimit(agentDid: string, endpointPath: string, limitQpm: number, forceSpike?: boolean) {
  const key = `${agentDid}::${endpointPath}`;
  const now = Date.now();
  const windowStart = now - 60_000;
  const recent = (rateLimitBuckets.get(key) ?? []).filter((ts) => ts >= windowStart);
  if (forceSpike) {
    // Populate synthetic spike timestamps so the sliding window genuinely crosses limitQpm
    while (recent.length < limitQpm) {
      recent.push(now - 50);
    }
  }
  const currentCount = recent.length + 1;
  recent.push(now);
  rateLimitBuckets.set(key, recent);
  return {
    allowed: currentCount <= limitQpm && !forceSpike,
    currentQpm: currentCount,
    limitQpm,
  };
}

function dispatchWebhooks(eventType: WebhookEventType, payload: Record<string, unknown>) {
  const db = loadDatabase();
  const targets = (db.webhooks ?? []).filter(
    (wh) => wh.active && wh.enabledEvents.includes(eventType),
  );
  if (targets.length === 0) return;

  const bodyStr = JSON.stringify({
    event: eventType,
    timestamp: new Date().toISOString(),
    source: 'accordgate-compliance-gateway',
    payload,
  });

  for (const wh of targets) {
    const start = Date.now();
    const signature = crypto
      .createHmac('sha256', wh.signingSecretPreview || 'accordgate-secret')
      .update(bodyStr)
      .digest('hex');

    fetch(wh.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-AccordGate-Event': eventType,
        'X-AccordGate-Signature': `sha256=${signature}`,
      },
      body: bodyStr,
      signal: AbortSignal.timeout(4000),
    })
      .then((resp) => {
        const latestDb = loadDatabase();
        const found = latestDb.webhooks.find((w) => w.id === wh.id);
        const deliveredAt = new Date().toISOString();
        if (found) {
          found.lastStatusCode = resp.status;
          found.lastDeliveredAt = deliveredAt;
        }
        latestDb.webhookDeliveries.unshift({
          id: 'del-' + crypto.randomUUID().slice(0, 8),
          webhookId: wh.id,
          webhookLabel: wh.label,
          eventType,
          statusCode: resp.status,
          ok: resp.ok,
          latencyMs: Date.now() - start,
          detail: `HTTP ${resp.status} ${resp.statusText || ''}`.trim(),
          deliveredAt,
        });
        latestDb.webhookDeliveries = latestDb.webhookDeliveries.slice(0, 25);
        saveDatabase(latestDb);
      })
      .catch((err) => {
        const latestDb = loadDatabase();
        const found = latestDb.webhooks.find((w) => w.id === wh.id);
        const deliveredAt = new Date().toISOString();
        if (found) {
          found.lastStatusCode = 0;
          found.lastDeliveredAt = deliveredAt;
        }
        latestDb.webhookDeliveries.unshift({
          id: 'del-' + crypto.randomUUID().slice(0, 8),
          webhookId: wh.id,
          webhookLabel: wh.label,
          eventType,
          statusCode: null,
          ok: false,
          latencyMs: Date.now() - start,
          detail: err instanceof Error ? err.message : 'Delivery failed',
          deliveredAt,
        });
        latestDb.webhookDeliveries = latestDb.webhookDeliveries.slice(0, 25);
        saveDatabase(latestDb);
      });
  }
}

function recordPolicyViolationAndCheckCircuitBreaker(
  db: GatewayDatabase,
  agent: AgentRecord,
  policy: GatePolicy,
  reason: string,
) {
  agent.consecutiveViolations = (agent.consecutiveViolations || 0) + 1;
  agent.updatedAt = new Date().toISOString();
  const threshold = policy.circuitBreakerThreshold || 3;
  if (agent.status === 'active' && agent.consecutiveViolations >= threshold) {
    agent.status = 'suspended';
    appendAuditEntryToDb(db, {
      requestId: 'cb-' + crypto.randomUUID().slice(0, 8),
      agentDid: agent.did,
      agentName: agent.name,
      endpointPath: policy.endpointPath,
      protocol: 'GOVERNANCE',
      decision: 'GOVERNANCE_CIRCUIT_OPENED',
      reason: `Circuit breaker auto-suspended "${agent.name}" after ${agent.consecutiveViolations} consecutive violations (${reason}).`,
      zkpClaims: {
        principalVerified: agent.verifiedPrincipal,
        ageThresholdMet: false,
        jurisdictionMatched: false,
        vcdcMatched: Boolean(agent.vcdcDomain),
        zkpCommitment: generateZkpCommitment({
          agentDid: agent.did,
          endpointPath: policy.endpointPath,
          principalVerified: agent.verifiedPrincipal,
          ageThresholdMet: false,
          jurisdictionMatched: false,
          vcdcMatched: Boolean(agent.vcdcDomain),
          nonce: agent.updatedAt,
        }),
        piiStored: false,
      },
      x402ReceiptId: null,
      amountPlt: 0,
    });
    dispatchWebhooks('circuit_breaker.opened', {
      agentId: agent.id,
      agentDid: agent.did,
      agentName: agent.name,
      consecutiveViolations: agent.consecutiveViolations,
      threshold,
      endpointPath: policy.endpointPath,
    });
  }
}

interface PipelineContext {
  replayGuard: AgentReplayGuard;
  now: () => number;
}

/** Random nonce for requests the server signs itself (owner sandbox). */
function newAgentNonce() {
  return crypto.randomBytes(16).toString('base64url');
}

function agentSigningPayload(did: string, endpointPath: string, timestamp: string, nonce: string, cardHash: string) {
  return `${did}|${endpointPath}|${timestamp}|${nonce}|${cardHash}`;
}

function evaluateCompliancePipeline(input: SandboxClaimInput, ctx: PipelineContext) {
  const db = loadDatabase();
  const requestId = 'req-' + crypto.randomUUID().slice(0, 12);
  const policy = db.policies.find((p) => p.endpointPath === input.endpointPath);

  if (!policy) {
    return {
      httpStatus: 404,
      outcome: 'NOT_FOUND' as const,
      requestId,
      traces: [] as PipelineStepTrace[],
      headers: {} as Record<string, string>,
      error: `Protected endpoint policy not found for ${input.endpointPath}`,
    };
  }

  const agent = db.agents.find((a) => a.did === input.agentDid);
  const traces: PipelineStepTrace[] = [];

  // Step 1: AgentGate Check (local registry + Agent Card SHA-256; the CIS-8004 contract is not read, SECURITY S3)
  if (!agent) {
    const zkpSummary = {
      principalVerified: false,
      ageThresholdMet: false,
      jurisdictionMatched: false,
      vcdcMatched: false,
      zkpCommitment: generateZkpCommitment({
        agentDid: input.agentDid,
        endpointPath: policy.endpointPath,
        principalVerified: false,
        ageThresholdMet: false,
        jurisdictionMatched: false,
        vcdcMatched: false,
        nonce: requestId,
      }),
      piiStored: false as const,
    };
    traces.push({
      step: 1,
      key: 'agentgate',
      title: 'AgentGate (local registry; CIS-8004 simulated)',
      status: 'failed',
      detail: `Agent DID ${input.agentDid} is not in the local registry (CIS-8004 contract not queried).`,
    });
    const audit = appendAuditEntryToDb(db, {
      requestId,
      agentDid: input.agentDid,
      agentName: 'Unknown Agent',
      endpointPath: policy.endpointPath,
      protocol: policy.protocol,
      decision: 'BLOCKED_UNVERIFIED',
      reason: 'Unregistered DID rejected by AgentGate middleware.',
      zkpClaims: zkpSummary,
      x402ReceiptId: null,
      amountPlt: 0,
    });
    saveDatabase(db);
    return {
      httpStatus: 403,
      outcome: 'BLOCKED_UNVERIFIED' as const,
      requestId,
      traces,
      audit,
      headers: { 'X-AgentGate-Status': 'unregistered' },
    };
  }

  if (agent.status !== 'active') {
    const zkpSummary = {
      principalVerified: false,
      ageThresholdMet: false,
      jurisdictionMatched: false,
      vcdcMatched: false,
      zkpCommitment: generateZkpCommitment({
        agentDid: agent.did,
        endpointPath: policy.endpointPath,
        principalVerified: false,
        ageThresholdMet: false,
        jurisdictionMatched: false,
        vcdcMatched: false,
        nonce: requestId,
      }),
      piiStored: false as const,
    };
    traces.push({
      step: 1,
      key: 'agentgate',
      title: 'AgentGate (local registry; CIS-8004 simulated)',
      status: 'failed',
      detail: `Agent status is "${agent.status.toUpperCase()}" in the local registry (CIS-8004 contract not queried).`,
      metadata: { status: agent.status, did: agent.did },
    });
    const audit = appendAuditEntryToDb(db, {
      requestId,
      agentDid: agent.did,
      agentName: agent.name,
      endpointPath: policy.endpointPath,
      protocol: policy.protocol,
      decision: 'BLOCKED_REVOKED',
      reason: `AgentGate blocked call: agent status is ${agent.status}.`,
      zkpClaims: zkpSummary,
      x402ReceiptId: null,
      amountPlt: 0,
    });
    saveDatabase(db);
    return {
      httpStatus: 403,
      outcome: 'BLOCKED_REVOKED' as const,
      requestId,
      traces,
      audit,
      headers: { 'X-AgentGate-Status': agent.status, 'X-Concordium-Agent-DID': agent.did },
    };
  }

  const parentAgent = agent.parentAgentId
    ? db.agents.find((a) => a.id === agent.parentAgentId) ?? null
    : null;
  if (parentAgent && parentAgent.status !== 'active') {
    const zkpSummary = {
      principalVerified: false,
      ageThresholdMet: false,
      jurisdictionMatched: false,
      vcdcMatched: false,
      zkpCommitment: generateZkpCommitment({
        agentDid: agent.did,
        endpointPath: policy.endpointPath,
        principalVerified: false,
        ageThresholdMet: false,
        jurisdictionMatched: false,
        vcdcMatched: false,
        nonce: requestId,
      }),
      piiStored: false as const,
    };
    traces.push({
      step: 1,
      key: 'agentgate',
      title: 'AgentGate (local registry; CIS-8004 simulated)',
      status: 'failed',
      detail: `Delegation parent "${parentAgent.name}" is "${parentAgent.status.toUpperCase()}". Sub-agent access blocked.`,
      metadata: { parentDid: parentAgent.did, parentStatus: parentAgent.status },
    });
    const audit = appendAuditEntryToDb(db, {
      requestId,
      agentDid: agent.did,
      agentName: agent.name,
      endpointPath: policy.endpointPath,
      protocol: policy.protocol,
      decision: 'BLOCKED_REVOKED',
      reason: `Delegation parent "${parentAgent.name}" is ${parentAgent.status}; child call denied.`,
      zkpClaims: zkpSummary,
      x402ReceiptId: null,
      amountPlt: 0,
    });
    saveDatabase(db);
    return {
      httpStatus: 403,
      outcome: 'BLOCKED_REVOKED' as const,
      requestId,
      traces,
      audit,
      headers: { 'X-AgentGate-Status': 'parent-revoked', 'X-Concordium-Agent-DID': agent.did },
    };
  }

  const canonicalDigest = computeAgentCardHash(agent.agentCard);
  const presentedCardHash = input.simulateTamperedCard
    ? sha256Hex('tampered-card-' + agent.cardHash)
    : agent.cardHash;

  if (presentedCardHash !== canonicalDigest) {
    const zkpSummary = {
      principalVerified: false,
      ageThresholdMet: false,
      jurisdictionMatched: false,
      vcdcMatched: false,
      zkpCommitment: generateZkpCommitment({
        agentDid: agent.did,
        endpointPath: policy.endpointPath,
        principalVerified: false,
        ageThresholdMet: false,
        jurisdictionMatched: false,
        vcdcMatched: false,
        nonce: requestId,
      }),
      piiStored: false as const,
    };
    traces.push({
      step: 1,
      key: 'agentgate',
      title: 'AgentGate (local registry; CIS-8004 simulated)',
      status: 'failed',
      detail: `Agent Card SHA-256 mismatch: presented ${presentedCardHash.slice(0, 14)}... != local registry ${canonicalDigest.slice(0, 14)}...`,
      metadata: { presentedCardHash, expectedCardHash: canonicalDigest },
    });
    const audit = appendAuditEntryToDb(db, {
      requestId,
      agentDid: agent.did,
      agentName: agent.name,
      endpointPath: policy.endpointPath,
      protocol: policy.protocol,
      decision: 'BLOCKED_CARD_TAMPERED',
      reason: 'Agent Card SHA-256 commitment mismatch detected by AgentGate.',
      zkpClaims: zkpSummary,
      x402ReceiptId: null,
      amountPlt: 0,
    });
    // The caller is not authenticated yet, so outside the owner sandbox this must not count
    // toward auto-suspension (anyone who knows a DID could otherwise suspend the agent).
    if (input.allowServerSigning) {
      recordPolicyViolationAndCheckCircuitBreaker(db, agent, policy, 'Agent Card SHA-256 tampered');
    }
    saveDatabase(db);
    return {
      httpStatus: 403,
      outcome: 'BLOCKED_CARD_TAMPERED' as const,
      requestId,
      traces,
      audit,
      headers: { 'X-AgentGate-Status': 'card-hash-mismatch' },
    };
  }

  traces.push({
    step: 1,
    key: 'agentgate',
    title: 'AgentGate (local registry; CIS-8004 simulated)',
    status: 'passed',
    detail: `Local registry check: status active, Card digest matches (${canonicalDigest.slice(0, 12)}...); CIS-8004 contract not queried · ${
      parentAgent ? `Delegated by "${parentAgent.name}" (depth ${agent.delegationDepth})` : 'Root Principal Agent'
    }.`,
    metadata: { did: agent.did, cardHash: canonicalDigest, contract: agent.registryContract },
  });

  // Step 2: Ed25519 Cryptographic Request Signature Verification
  const serverSigns = !input.providedSignatureHex && Boolean(input.allowServerSigning);
  const timestamp = input.providedTimestamp || new Date(ctx.now()).toISOString();
  const nonce = input.providedNonce || (serverSigns ? newAgentNonce() : '');
  const signingPayload = agentSigningPayload(agent.did, policy.endpointPath, timestamp, nonce, canonicalDigest);
  let signatureHex = input.providedSignatureHex || '';
  if (serverSigns) {
    const privateKeyPem = db.proverKeys?.[agent.did];
    signatureHex = privateKeyPem ? signAgentRequest(privateKeyPem, signingPayload) : '';
  }
  if (input.simulateInvalidSignature && signatureHex.length > 8) {
    const flipped = signatureHex.startsWith('00') ? 'ff' : '00';
    signatureHex = flipped + signatureHex.slice(2);
  }

  const signatureValid = Boolean(signatureHex) && verifyAgentSignature(agent.publicKeyHex, signingPayload, signatureHex);
  if (!signatureValid) {
    const zkpSummary = {
      principalVerified: false,
      ageThresholdMet: false,
      jurisdictionMatched: false,
      vcdcMatched: false,
      zkpCommitment: generateZkpCommitment({
        agentDid: agent.did,
        endpointPath: policy.endpointPath,
        principalVerified: false,
        ageThresholdMet: false,
        jurisdictionMatched: false,
        vcdcMatched: false,
        nonce: requestId,
      }),
      piiStored: false as const,
    };
    traces.push({
      step: 2,
      key: 'signature',
      title: 'Ed25519 Request Signature',
      status: 'failed',
      detail: `Cryptographic signature verification failed against agent publicKey (${agent.publicKeyHex.slice(0, 16)}...). Impersonation blocked.`,
      metadata: { signatureHex: signatureHex.slice(0, 24) + '...' },
    });
    const audit = appendAuditEntryToDb(db, {
      requestId,
      agentDid: agent.did,
      agentName: agent.name,
      endpointPath: policy.endpointPath,
      protocol: policy.protocol,
      decision: 'BLOCKED_SIGNATURE_INVALID',
      reason: 'Ed25519 request signature mismatch: caller lacks private key corresponding to registered DID.',
      zkpClaims: zkpSummary,
      x402ReceiptId: null,
      amountPlt: 0,
    });
    // An invalid signature does not prove the caller is the agent; only the owner sandbox counts it.
    if (input.allowServerSigning) {
      recordPolicyViolationAndCheckCircuitBreaker(db, agent, policy, 'Invalid Ed25519 signature');
    }
    saveDatabase(db);
    return {
      httpStatus: 403,
      outcome: 'BLOCKED_SIGNATURE_INVALID' as const,
      requestId,
      traces,
      audit,
      headers: { 'X-AgentGate-Status': 'invalid-ed25519-signature' },
    };
  }

  traces.push({
    step: 2,
    key: 'signature',
    title: 'Ed25519 Request Signature',
    status: 'passed',
    detail: `Verified Ed25519 signature (${signatureHex.slice(0, 14)}...) against registered SPKI public key.`,
    metadata: { signatureHex: signatureHex.slice(0, 24) + '...', timestamp },
  });

  // Step 2b (S7): freshness window + single-use nonce. Runs only after the signature is valid, so
  // only the agent's key holder can add nonces. Synchronous check-and-record: no await in between.
  const freshness = ctx.replayGuard.check(agent.did, timestamp, nonce);
  if (!freshness.ok) {
    const replayed = freshness.reason === 'replayed';
    const tooMany = freshness.reason === 'too-many';
    const decision = tooMany ? 'BLOCKED_RATE_LIMITED' : replayed ? 'BLOCKED_REPLAYED' : 'BLOCKED_STALE_REQUEST';
    const httpStatus = tooMany ? 429 : 403;
    const gateStatus = tooMany ? 'too-many-nonces' : replayed ? 'replayed-nonce' : 'stale-timestamp';
    traces.push({
      step: 2,
      key: 'freshness',
      title: 'Request Freshness (timestamp window + nonce)',
      status: 'failed',
      detail: freshness.detail,
      metadata: { reason: freshness.reason, timestamp },
    });
    const audit = appendAuditEntryToDb(db, {
      requestId,
      agentDid: agent.did,
      agentName: agent.name,
      endpointPath: policy.endpointPath,
      protocol: policy.protocol,
      decision,
      reason: `Request freshness check failed (${freshness.reason}): ${freshness.detail}`,
      zkpClaims: {
        principalVerified: false,
        ageThresholdMet: false,
        jurisdictionMatched: false,
        vcdcMatched: false,
        zkpCommitment: generateZkpCommitment({
          agentDid: agent.did,
          endpointPath: policy.endpointPath,
          principalVerified: false,
          ageThresholdMet: false,
          jurisdictionMatched: false,
          vcdcMatched: false,
          nonce: requestId,
        }),
        piiStored: false as const,
      },
      x402ReceiptId: null,
      amountPlt: 0,
    });
    // A replayed or stale request does not prove the agent misbehaved, so it never counts
    // toward the circuit breaker.
    saveDatabase(db);
    return {
      httpStatus,
      outcome: decision,
      requestId,
      traces,
      audit,
      headers: { 'X-AgentGate-Status': gateStatus } as Record<string, string>,
    };
  }

  traces.push({
    step: 2,
    key: 'freshness',
    title: 'Request Freshness (timestamp window + nonce)',
    status: 'passed',
    detail: `Timestamp inside the window and nonce used for the first time.`,
    metadata: { timestamp },
  });

  // Step 3: Sliding-Window Rate Limiter & Circuit Breaker Check
  const limitQpm = policy.rateLimitQpm || 20;
  const rateCheck = recordAndCheckRateLimit(
    agent.did,
    policy.endpointPath,
    limitQpm,
    Boolean(input.simulateRateLimitSpike),
  );
  if (!rateCheck.allowed) {
    const zkpSummary = {
      principalVerified: false,
      ageThresholdMet: false,
      jurisdictionMatched: false,
      vcdcMatched: false,
      zkpCommitment: generateZkpCommitment({
        agentDid: agent.did,
        endpointPath: policy.endpointPath,
        principalVerified: false,
        ageThresholdMet: false,
        jurisdictionMatched: false,
        vcdcMatched: false,
        nonce: requestId,
      }),
      piiStored: false as const,
    };
    traces.push({
      step: 3,
      key: 'ratelimit',
      title: 'Rate Limit & Circuit Breaker',
      status: 'failed',
      detail: `Sliding-window QPM exceeded (${rateCheck.currentQpm} / ${rateCheck.limitQpm} req/min). HTTP 429 throttled.`,
      metadata: rateCheck,
    });
    const audit = appendAuditEntryToDb(db, {
      requestId,
      agentDid: agent.did,
      agentName: agent.name,
      endpointPath: policy.endpointPath,
      protocol: policy.protocol,
      decision: 'BLOCKED_RATE_LIMITED',
      reason: `Sliding-window rate limit exceeded (${rateCheck.currentQpm}/${rateCheck.limitQpm} QPM).`,
      zkpClaims: zkpSummary,
      x402ReceiptId: null,
      amountPlt: 0,
    });
    recordPolicyViolationAndCheckCircuitBreaker(db, agent, policy, 'Rate limit exceeded');
    saveDatabase(db);
    dispatchWebhooks('rate_limit.exceeded', {
      agentDid: agent.did,
      agentName: agent.name,
      endpointPath: policy.endpointPath,
      currentQpm: rateCheck.currentQpm,
      limitQpm: rateCheck.limitQpm,
    });
    return {
      httpStatus: 429,
      outcome: 'BLOCKED_RATE_LIMITED' as const,
      requestId,
      traces,
      audit,
      headers: {
        'X-RateLimit-Limit': String(rateCheck.limitQpm),
        'X-RateLimit-Remaining': '0',
      },
    };
  }

  traces.push({
    step: 3,
    key: 'ratelimit',
    title: 'Rate Limit & Circuit Breaker',
    status: 'passed',
    detail: `Sliding window nominal (${rateCheck.currentQpm} / ${rateCheck.limitQpm} QPM) · Violations: ${agent.consecutiveViolations}/${policy.circuitBreakerThreshold || 3}.`,
    metadata: { ...rateCheck, consecutiveViolations: agent.consecutiveViolations, threshold: policy.circuitBreakerThreshold || 3 },
  });

  // Step 3: ZKP Privacy Gatekeeper (Zero PII stored)
  const principalVerified = input.principalVerifiedClaim && agent.verifiedPrincipal;
  const ageThresholdMet =
    policy.requiredZkpPredicates.minAge === null || input.ageClaim >= policy.requiredZkpPredicates.minAge;
  const jurisdictionMatched =
    policy.requiredZkpPredicates.allowedJurisdictions.length === 0 ||
    policy.requiredZkpPredicates.allowedJurisdictions.includes(input.jurisdictionClaim);
  const vcdcMatched = !policy.requiredZkpPredicates.requireVcdcDomain || Boolean(agent.vcdcDomain);

  const zkpCommitment = generateZkpCommitment({
    agentDid: agent.did,
    endpointPath: policy.endpointPath,
    principalVerified,
    ageThresholdMet,
    jurisdictionMatched,
    vcdcMatched,
    nonce: requestId,
  });

  const zkpClaims = {
    principalVerified,
    ageThresholdMet,
    jurisdictionMatched,
    vcdcMatched,
    zkpCommitment,
    piiStored: false as const,
  };

  if (!principalVerified || !ageThresholdMet || !jurisdictionMatched || !vcdcMatched) {
    const failedReasons: string[] = [];
    if (!principalVerified) failedReasons.push('Self-reported principal KYC claim missing');
    if (!ageThresholdMet) failedReasons.push(`Age predicate >= ${policy.requiredZkpPredicates.minAge} failed`);
    if (!jurisdictionMatched)
      failedReasons.push(
        `Jurisdiction "${input.jurisdictionClaim}" outside [${policy.requiredZkpPredicates.allowedJurisdictions.join(', ')}]`,
      );
    if (!vcdcMatched) failedReasons.push('VCDC domain binding required');

    traces.push({
      step: 4,
      key: 'zkp',
      title: 'ZKP Gatekeeper (simulated: self-reported claims + SHA-256 commitment)',
      status: 'failed',
      detail: `${failedReasons.join(' · ')} (self-reported claims; no zero-knowledge proof checked).`,
      metadata: { zkpClaims, required: policy.requiredZkpPredicates },
    });

    const audit = appendAuditEntryToDb(db, {
      requestId,
      agentDid: agent.did,
      agentName: agent.name,
      endpointPath: policy.endpointPath,
      protocol: policy.protocol,
      decision: 'BLOCKED_ZKP_FAILED',
      reason: `Self-reported claims do not meet the policy (simulated ZKP, no proof checked): ${failedReasons.join('; ')}`,
      zkpClaims,
      x402ReceiptId: null,
      amountPlt: 0,
    });
    recordPolicyViolationAndCheckCircuitBreaker(db, agent, policy, failedReasons.join('; '));
    saveDatabase(db);
    return {
      httpStatus: 403,
      outcome: 'BLOCKED_ZKP_FAILED' as const,
      requestId,
      traces,
      audit,
      headers: { 'X-ZKP-Verified': 'false', 'X-ZKP-Commitment': zkpCommitment },
    };
  }

  traces.push({
    step: 4,
    key: 'zkp',
    title: 'ZKP Gatekeeper (simulated: self-reported claims + SHA-256 commitment)',
    status: 'passed',
    detail: `Self-reported claims meet the policy, no zero-knowledge proof checked (${policy.requiredZkpPredicates.allowedJurisdictions.join('/')}${
      policy.requiredZkpPredicates.minAge ? `, ${policy.requiredZkpPredicates.minAge}+` : ''
    }${policy.requiredZkpPredicates.requireVcdcDomain ? `, VCDC: ${agent.vcdcDomain}` : ''}) · PII Stored: false.`,
    metadata: { zkpClaims },
  });

  // Step 5: Guardrail Engine (Per-Call & Daily Spending Cap)
  const requestedSpend = (input.requestedTransferPlt ?? 0) + policy.x402PricePlt;
  const effectivePerCallCap = Math.min(agent.perCallLimitPlt, policy.maxPerCallPlt);
  const effectiveDailyCap = Math.min(agent.dailyLimitPlt, policy.dailyAgentCapPlt);

  if (requestedSpend > effectivePerCallCap || agent.dailySpentPlt + requestedSpend > effectiveDailyCap) {
    const limitMsg =
      requestedSpend > effectivePerCallCap
        ? `Requested ${requestedSpend.toFixed(2)} PLT exceeds per-call guardrail (${effectivePerCallCap.toFixed(2)} PLT).`
        : `Projected daily spend ${(agent.dailySpentPlt + requestedSpend).toFixed(2)} PLT exceeds daily cap (${effectiveDailyCap.toFixed(2)} PLT).`;

    traces.push({
      step: 5,
      key: 'guardrail',
      title: 'Spending Guardrails & Locks',
      status: 'failed',
      detail: limitMsg,
      metadata: { requestedSpend, effectivePerCallCap, dailySpentPlt: agent.dailySpentPlt, effectiveDailyCap },
    });

    const audit = appendAuditEntryToDb(db, {
      requestId,
      agentDid: agent.did,
      agentName: agent.name,
      endpointPath: policy.endpointPath,
      protocol: policy.protocol,
      decision: 'BLOCKED_SPENDING_LIMIT',
      reason: limitMsg,
      zkpClaims,
      x402ReceiptId: null,
      amountPlt: requestedSpend,
    });
    recordPolicyViolationAndCheckCircuitBreaker(db, agent, policy, limitMsg);
    saveDatabase(db);
    return {
      httpStatus: 403,
      outcome: 'BLOCKED_SPENDING_LIMIT' as const,
      requestId,
      traces,
      audit,
      headers: { 'X-Guardrail-Status': 'limit-exceeded' },
    };
  }

  traces.push({
    step: 5,
    key: 'guardrail',
    title: 'Spending Guardrails & Locks',
    status: 'passed',
    detail: `Within policy caps: ${requestedSpend.toFixed(2)} / ${effectivePerCallCap.toFixed(
      2,
    )} PLT per-call · ${(agent.dailySpentPlt + requestedSpend).toFixed(2)} / ${effectiveDailyCap.toFixed(2)} PLT daily.`,
    metadata: { requestedSpend, effectivePerCallCap, effectiveDailyCap },
  });

  // Step 5: x402 Payment + CIS-3 Sponsored Gas (both simulated, SECURITY S3)
  let settledInvoice: X402Invoice | null = null;
  if (policy.x402PricePlt > 0) {
    if (input.paymentReceiptId) {
      settledInvoice =
        db.invoices.find(
          (inv) =>
            inv.invoiceId === input.paymentReceiptId &&
            inv.status === 'settled' &&
            inv.agentDid === agent.did &&
            inv.endpointPath === policy.endpointPath,
        ) ?? null;
    }

    if (!settledInvoice) {
      const invoice: X402Invoice = {
        invoiceId: 'x402-' + crypto.randomUUID().slice(0, 10),
        agentDid: agent.did,
        endpointPath: policy.endpointPath,
        amountPlt: policy.x402PricePlt,
        asset: policy.asset,
        sponsorAccount: SIMULATED_SPONSOR,
        gasFeeCcd: 0.0121,
        gasPaidByAgent: 0,
        status: 'challenged',
        txHash: null,
        createdAt: new Date().toISOString(),
        settledAt: null,
        simulated: true,
      };
      db.invoices.push(invoice);

      traces.push({
        step: 6,
        key: 'x402',
        title: 'x402 Payment & CIS-3 Sponsored Tx (simulated)',
        status: 'challenged',
        detail: `HTTP 402 Payment Required: ${invoice.amountPlt.toFixed(2)} ${invoice.asset} · simulated settlement, no payment or CIS-3 sponsored transaction is sent.`,
        metadata: { invoice },
      });

      const audit = appendAuditEntryToDb(db, {
        requestId,
        agentDid: agent.did,
        agentName: agent.name,
        endpointPath: policy.endpointPath,
        protocol: policy.protocol,
        decision: 'PAYMENT_REQUIRED',
        reason: `Issued HTTP 402 x402 invoice (${invoice.invoiceId}) for ${invoice.amountPlt.toFixed(2)} ${invoice.asset} (simulated settlement).`,
        zkpClaims,
        x402ReceiptId: invoice.invoiceId,
        amountPlt: invoice.amountPlt,
      });
      saveDatabase(db);

      return {
        httpStatus: 402,
        outcome: 'PAYMENT_REQUIRED' as const,
        requestId,
        invoice,
        traces,
        audit,
        headers: {
          'X-Payment-Required': `x402 amount=${invoice.amountPlt} asset=${invoice.asset} invoice=${invoice.invoiceId}`,
          'X-CIS3-Sponsor': invoice.sponsorAccount,
          'X-ZKP-Commitment': zkpCommitment,
        },
      };
    }

    traces.push({
      step: 6,
      key: 'x402',
      title: 'x402 Payment & CIS-3 Sponsored Tx (simulated)',
      status: 'passed',
      detail: `Simulated settlement of ${settledInvoice.amountPlt.toFixed(2)} ${settledInvoice.asset} (${settledInvoice.txHash?.slice(
        0,
        18,
      )}..., not on chain, no transfer) · CIS-3 gas sponsorship simulated.`,
      metadata: { invoice: settledInvoice },
    });
  } else {
    traces.push({
      step: 6,
      key: 'x402',
      title: 'x402 Payment & CIS-3 Sponsored Tx (simulated)',
      status: 'skipped',
      detail: 'Zero-fee internal compliance endpoint (0.00 EURt).',
    });
  }

  // Reset consecutive violation counter on clean execution & commit Step 7 EU AI Act audit record
  agent.consecutiveViolations = 0;
  agent.dailySpentPlt = Number((agent.dailySpentPlt + requestedSpend).toFixed(2));
  agent.updatedAt = new Date().toISOString();

  const audit = appendAuditEntryToDb(db, {
    requestId,
    agentDid: agent.did,
    agentName: agent.name,
    endpointPath: policy.endpointPath,
    protocol: policy.protocol,
    decision: 'ALLOWED',
    reason: `Allowed via AgentGate (local registry) + Ed25519 + RateLimit + ZKP gatekeeper (simulated)${
      settledInvoice ? ` + x402 (${settledInvoice.amountPlt.toFixed(2)} ${settledInvoice.asset}, simulated settlement)` : ''
    }.`,
    zkpClaims,
    x402ReceiptId: settledInvoice ? settledInvoice.invoiceId : null,
    amountPlt: requestedSpend,
  });

  traces.push({
    step: 7,
    key: 'audit',
    title: 'EU AI Act Hash-Chained Audit',
    status: 'passed',
    detail: `Committed immutable entry #${audit.seq} (${audit.entryHash.slice(0, 14)}...) linked to prevHash ${audit.prevHash.slice(0, 12)}...`,
    metadata: { seq: audit.seq, entryHash: audit.entryHash, prevHash: audit.prevHash },
  });

  saveDatabase(db);

  return {
    httpStatus: 200,
    outcome: 'ALLOWED' as const,
    requestId,
    traces,
    audit,
    toolResponse: {
      service: policy.serviceName,
      protocol: policy.protocol,
      executedAt: new Date().toISOString(),
      accountablePrincipal: agent.ownerEntity,
      vcdcDomain: agent.vcdcDomain,
      zkpCommitment,
      piiStoredOnGateway: false,
      x402Receipt: settledInvoice
        ? {
            invoiceId: settledInvoice.invoiceId,
            txHash: settledInvoice.txHash,
            amountPlt: settledInvoice.amountPlt,
            gasPaidByAgentCcd: 0,
            simulated: true,
          }
        : null,
      resultSummary:
        policy.protocol === 'MCP'
          ? `MCP tool "${policy.serviceName}" executed; decision recorded in the EU AI Act audit chain.`
          : `REST payload delivered for "${policy.serviceName}" under the (simulated) ZKP gate.`,
    },
    headers: {
      'X-AgentGate-Status': 'active-local-registry',
      'X-Ed25519-Verified': 'true',
      'X-ZKP-Commitment': zkpCommitment,
      'X-EU-AI-Act-Audit-Hash': audit.entryHash,
    },
  };
}

function toCsv(logs: AuditEntry[]): string {
  const header = [
    'seq',
    'timestamp',
    'request_id',
    'agent_did',
    'agent_name',
    'endpoint',
    'protocol',
    'decision',
    'principal_verified',
    'age_threshold_met',
    'jurisdiction_matched',
    'vcdc_matched',
    'pii_stored',
    'zkp_commitment',
    'x402_receipt_id',
    'amount_plt',
    'prev_hash',
    'entry_hash',
    'reason',
  ];
  const esc = (val: unknown) => `"${String(val ?? '').replace(/"/g, '""')}"`;
  const rows = logs.map((e) =>
    [
      e.seq,
      e.timestamp,
      e.requestId,
      e.agentDid,
      e.agentName,
      e.endpointPath,
      e.protocol,
      e.decision,
      e.zkpClaims.principalVerified,
      e.zkpClaims.ageThresholdMet,
      e.zkpClaims.jurisdictionMatched,
      e.zkpClaims.vcdcMatched,
      e.zkpClaims.piiStored,
      e.zkpClaims.zkpCommitment,
      e.x402ReceiptId ?? '',
      e.amountPlt.toFixed(2),
      e.prevHash,
      e.entryHash,
      e.reason,
    ]
      .map(esc)
      .join(','),
  );
  return [header.join(','), ...rows].join('\n');
}

/** Reads an account's credential keys from Concordium testnet (used to verify wallet sign-in). */
const getTestnetAccountInfo: AccountInfoLookup = async (address) => {
  const client = createTestnetGrpcClient();
  try {
    return await client.getAccountInfo(address);
  } catch (err) {
    if ((err as { code?: unknown })?.code === 'NOT_FOUND') {
      throw new AccountNotFoundError('Account not found on Concordium testnet');
    }
    throw err;
  }
};

function maskWebhookSecret(wh: WebhookConfig): WebhookConfig {
  const secret = wh.signingSecretPreview || '';
  return { ...wh, signingSecretPreview: secret ? `whsec_…${secret.slice(-4)}` : '' };
}

export interface AppDeps {
  ownerAccounts: string[];
  getAccountInfo: AccountInfoLookup;
  now?: () => number;
  secureCookie?: boolean;
  /** Max unexpired nonces per agent (S7); tests set it low. */
  agentNoncePerAgentCap?: number;
}

/** Builds the Express app with all /api routes (no Vite, no listen) so tests can run it. */
export function createApp(deps: AppDeps) {
  const app = express();
  // Exact path matching, so only the paths the owner guard checks reach a handler.
  app.set('case sensitive routing', true);
  app.set('strict routing', true);
  app.use(express.json());

  loadDatabase();

  const now = deps.now ?? (() => Date.now());
  // S7: per-process nonce store for agent requests (single instance only, like auth sessions).
  const pipelineCtx: PipelineContext = {
    now,
    replayGuard: createAgentReplayGuard({ now, perAgentCap: deps.agentNoncePerAgentCap ?? DEFAULT_PER_AGENT_CAP }),
  };

  const auth = createAuth(deps);
  app.use(auth.router);
  // Every route listed in OWNER_ROUTES (server/auth.ts) needs a signed-in owner.
  app.use(auth.ownerGuard);

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', service: 'accordgate-compliance-gateway', timestamp: new Date().toISOString() });
  });

  app.get('/api/overview', (_req, res) => {
    const db = loadDatabase();
    const activeAgents = db.agents.filter((a) => a.status === 'active').length;
    const totalCalls = db.auditLogs.filter((l) => l.protocol === 'MCP' || l.protocol === 'REST').length;
    const blockedCalls = db.auditLogs.filter((l) => l.decision.startsWith('BLOCKED_')).length;
    const settledInvoices = db.invoices.filter((i) => i.status === 'settled');
    const totalSettledPlt = settledInvoices.reduce((acc, i) => acc + i.amountPlt, 0);
    const totalGasSavedCcd = settledInvoices.reduce((acc, i) => acc + i.gasFeeCcd, 0);
    const chainStatus = verifyAuditHashChain(db.auditLogs);

    res.json({
      metrics: {
        activeAgents,
        totalAgents: db.agents.length,
        enforcedPolicies: db.policies.length,
        totalCalls,
        blockedCalls,
        allowedCalls: db.auditLogs.filter((l) => l.decision === 'ALLOWED').length,
        totalSettledPlt: Number(totalSettledPlt.toFixed(2)),
        totalGasSavedCcd: Number(totalGasSavedCcd.toFixed(4)),
        chainValid: chainStatus.valid,
        auditEntries: db.auditLogs.length,
        tamperDemoActive: Boolean(db.tamperBackup),
      },
      recentLogs: [...db.auditLogs].reverse().slice(0, 8),
    });
  });

  app.get('/api/agents', (_req, res) => {
    const db = loadDatabase();
    res.json({ agents: db.agents });
  });

  app.post('/api/agents', (req, res) => {
    const {
      name,
      role,
      ownerEntity,
      vcdcDomain,
      chain,
      externalAddress,
      mcpEndpoint,
      capabilities,
      dailyLimitPlt,
      perCallLimitPlt,
      parentAgentId,
      cascadeRevoke,
      walletAddress,
    } = req.body ?? {};
    if (!name || !ownerEntity || !externalAddress) {
      res.status(400).json({ error: 'name, ownerEntity, and externalAddress are required.' });
      return;
    }
    const db = loadDatabase();
    let delegationDepth = 0;
    let resolvedParentId: string | null = null;
    if (parentAgentId) {
      const parent = db.agents.find((a) => a.id === String(parentAgentId));
      if (!parent) {
        res.status(400).json({ error: 'Parent agent not found.' });
        return;
      }
      if (parent.delegationDepth >= 4) {
        res.status(400).json({ error: 'Maximum delegation depth (5) reached.' });
        return;
      }
      resolvedParentId = parent.id;
      delegationDepth = parent.delegationDepth + 1;
    }

    const { agent, privateKeyPem } = createNewAgentRecord({
      name: String(name).trim(),
      role: String(role || 'Enterprise AI Agent').trim(),
      ownerEntity: String(ownerEntity).trim(),
      vcdcDomain: vcdcDomain ? String(vcdcDomain).trim() : null,
      chain: chain === 'Solana' || chain === 'Base' ? chain : 'Ethereum',
      externalAddress: String(externalAddress).trim(),
      mcpEndpoint: String(mcpEndpoint || 'https://mcp.enterprise.internal/agent').trim(),
      capabilities: Array.isArray(capabilities) && capabilities.length > 0 ? capabilities.map(String) : ['sanctions.screen'],
      dailyLimitPlt: Number(dailyLimitPlt) > 0 ? Number(dailyLimitPlt) : 500,
      perCallLimitPlt: Number(perCallLimitPlt) > 0 ? Number(perCallLimitPlt) : 100,
      parentAgentId: resolvedParentId,
      delegationDepth,
      cascadeRevoke: cascadeRevoke !== false,
      walletAddress: walletAddress ? String(walletAddress).trim() : null,
    });
    db.agents.unshift(agent);
    db.proverKeys[agent.did] = privateKeyPem;

    appendAuditEntryToDb(db, {
      requestId: 'gov-' + crypto.randomUUID().slice(0, 8),
      agentDid: agent.did,
      agentName: agent.name,
      endpointPath: '/registry/cis-8004',
      protocol: 'GOVERNANCE',
      decision: 'AGENT_REGISTERED',
      reason: `Registered agent "${agent.name}" in the local registry (not written to CIS-8004)${
        resolvedParentId ? ` (delegated depth ${delegationDepth})` : ''
      } with Ed25519 keypair & CIS-8 ${agent.externalKeys[0].chain} key binding (not verified on chain).`,
      zkpClaims: {
        principalVerified: true,
        ageThresholdMet: true,
        jurisdictionMatched: true,
        vcdcMatched: Boolean(agent.vcdcDomain),
        zkpCommitment: generateZkpCommitment({
          agentDid: agent.did,
          endpointPath: '/registry/cis-8004',
          principalVerified: true,
          ageThresholdMet: true,
          jurisdictionMatched: true,
          vcdcMatched: Boolean(agent.vcdcDomain),
          nonce: agent.id,
        }),
        piiStored: false,
      },
      x402ReceiptId: null,
      amountPlt: 0,
    });

    saveDatabase(db);
    res.status(201).json({ agent });
  });

  app.patch('/api/agents/:id/status', (req, res) => {
    const { status } = req.body ?? {};
    const nextStatus: AgentStatus | null =
      status === 'active' || status === 'suspended' || status === 'revoked' ? status : null;
    if (!nextStatus) {
      res.status(400).json({ error: 'Invalid status. Must be active, suspended, or revoked.' });
      return;
    }

    const db = loadDatabase();
    const agent = db.agents.find((a) => a.id === req.params.id);
    if (!agent) {
      res.status(404).json({ error: 'Agent not found.' });
      return;
    }

    const prevStatus = agent.status;
    agent.status = nextStatus;
    if (nextStatus === 'active') {
      agent.consecutiveViolations = 0;
    }
    agent.updatedAt = new Date().toISOString();

    appendAuditEntryToDb(db, {
      requestId: 'gov-' + crypto.randomUUID().slice(0, 8),
      agentDid: agent.did,
      agentName: agent.name,
      endpointPath: '/registry/cis-8004/status',
      protocol: 'GOVERNANCE',
      decision: nextStatus === 'revoked' ? 'GOVERNANCE_REVOKED' : 'GOVERNANCE_REACTIVATED',
      reason: `Local registry status changed from ${prevStatus} to ${nextStatus} by compliance administrator (not written to CIS-8004).`,
      zkpClaims: {
        principalVerified: agent.verifiedPrincipal,
        ageThresholdMet: true,
        jurisdictionMatched: true,
        vcdcMatched: Boolean(agent.vcdcDomain),
        zkpCommitment: generateZkpCommitment({
          agentDid: agent.did,
          endpointPath: '/registry/cis-8004/status',
          principalVerified: agent.verifiedPrincipal,
          ageThresholdMet: true,
          jurisdictionMatched: true,
          vcdcMatched: Boolean(agent.vcdcDomain),
          nonce: agent.updatedAt,
        }),
        piiStored: false,
      },
      x402ReceiptId: null,
      amountPlt: 0,
    });

    const cascadedIds: string[] = [];
    if (nextStatus === 'revoked' && agent.cascadeRevoke) {
      const descendants = collectDescendantAgents(db.agents, agent.id);
      for (const child of descendants) {
        if (child.status !== 'revoked') {
          child.status = 'revoked';
          child.updatedAt = new Date().toISOString();
          cascadedIds.push(child.id);
          appendAuditEntryToDb(db, {
            requestId: 'gov-' + crypto.randomUUID().slice(0, 8),
            agentDid: child.did,
            agentName: child.name,
            endpointPath: '/registry/cis-8004/cascade',
            protocol: 'GOVERNANCE',
            decision: 'GOVERNANCE_CASCADE_REVOKED',
            reason: `Cascade Kill Switch triggered by parent "${agent.name}" (${agent.did}).`,
            zkpClaims: {
              principalVerified: child.verifiedPrincipal,
              ageThresholdMet: true,
              jurisdictionMatched: true,
              vcdcMatched: Boolean(child.vcdcDomain),
              zkpCommitment: generateZkpCommitment({
                agentDid: child.did,
                endpointPath: '/registry/cis-8004/cascade',
                principalVerified: child.verifiedPrincipal,
                ageThresholdMet: true,
                jurisdictionMatched: true,
                vcdcMatched: Boolean(child.vcdcDomain),
                nonce: child.updatedAt,
              }),
              piiStored: false,
            },
            x402ReceiptId: null,
            amountPlt: 0,
          });
        }
      }
    }

    saveDatabase(db);

    if (nextStatus === 'revoked') {
      dispatchWebhooks(cascadedIds.length > 0 ? 'agent.cascade_revoked' : 'agent.revoked', {
        agentId: agent.id,
        agentDid: agent.did,
        agentName: agent.name,
        cascadedCount: cascadedIds.length,
        cascadedIds,
      });
    }

    res.json({ agent, cascadedIds });
  });

  app.post('/api/agents/:id/rotate-card', (req, res) => {
    const db = loadDatabase();
    const agent = db.agents.find((a) => a.id === req.params.id);
    if (!agent) {
      res.status(404).json({ error: 'Agent not found.' });
      return;
    }
    const parts = agent.agentCard.version.split('.').map(Number);
    parts[2] = (parts[2] || 0) + 1;
    agent.agentCard.version = parts.join('.');
    agent.cardHash = computeAgentCardHash(agent.agentCard);
    agent.updatedAt = new Date().toISOString();
    saveDatabase(db);
    res.json({ agent });
  });

  // Real DNS TXT lookup for VCDC Domain Control verification
  app.post('/api/agents/:id/verify-vcdc', async (req, res) => {
    const db = loadDatabase();
    const agent = db.agents.find((a) => a.id === req.params.id);
    if (!agent) {
      res.status(404).json({ error: 'Agent not found.' });
      return;
    }
    if (!agent.vcdcDomain) {
      res.json({
        domain: null,
        dnsResolved: false,
        vcdcProofFound: false,
        txtRecords: [],
        expectedTxtRecord: `concordium-did=${agent.did}`,
        detail: '该 Agent 未配置 VCDC 企业域名。',
      });
      return;
    }

    try {
      const records = await dns.resolveTxt(agent.vcdcDomain);
      const flat = records.map((parts) => parts.join('')).slice(0, 8);
      const vcdcProofFound = flat.some(
        (txt) => txt.includes(agent.did) || txt.toLowerCase().includes('concordium'),
      );
      res.json({
        domain: agent.vcdcDomain,
        dnsResolved: true,
        vcdcProofFound,
        txtRecords: flat,
        expectedTxtRecord: `concordium-did=${agent.did}`,
        detail: vcdcProofFound
          ? `已在 ${agent.vcdcDomain} 检测到 Concordium TXT 声明记录。`
          : `DNS TXT 查询成功（返回 ${flat.length} 条记录），但尚未发布 concordium-did 绑定 TXT 记录。`,
      });
    } catch (err) {
      res.json({
        domain: agent.vcdcDomain,
        dnsResolved: false,
        vcdcProofFound: false,
        txtRecords: [],
        expectedTxtRecord: `concordium-did=${agent.did}`,
        detail: `DNS TXT 查询未命中 (${err instanceof Error ? err.message : 'Lookup error'})。`,
      });
    }
  });

  app.get('/api/policies', (_req, res) => {
    const db = loadDatabase();
    res.json({ policies: db.policies });
  });

  app.post('/api/policies', (req, res) => {
    const {
      serviceName,
      endpointPath,
      protocol,
      description,
      requiredZkpPredicates,
      maxPerCallPlt,
      dailyAgentCapPlt,
      x402PricePlt,
      sponsoredGas,
      rateLimitQpm,
      circuitBreakerThreshold,
    } = req.body ?? {};

    if (!serviceName || !endpointPath) {
      res.status(400).json({ error: 'serviceName and endpointPath are required.' });
      return;
    }

    const normalizedPath = String(endpointPath).trim().startsWith('/')
      ? String(endpointPath).trim()
      : '/' + String(endpointPath).trim();

    const db = loadDatabase();
    if (db.policies.some((p) => p.endpointPath === normalizedPath)) {
      res.status(409).json({ error: `Policy already exists for ${normalizedPath}` });
      return;
    }

    const newPolicy: GatePolicy = {
      id: 'pol-' + crypto.randomUUID().slice(0, 8),
      serviceName: String(serviceName).trim(),
      endpointPath: normalizedPath,
      protocol: protocol === 'REST' ? 'REST' : 'MCP',
      description: String(description || 'Custom enterprise compliance-gated endpoint.').trim(),
      requiredZkpPredicates: {
        principalVerified: requiredZkpPredicates?.principalVerified !== false,
        minAge:
          requiredZkpPredicates?.minAge === null || requiredZkpPredicates?.minAge === undefined
            ? null
            : Number(requiredZkpPredicates.minAge),
        allowedJurisdictions:
          Array.isArray(requiredZkpPredicates?.allowedJurisdictions) &&
          requiredZkpPredicates.allowedJurisdictions.length > 0
            ? requiredZkpPredicates.allowedJurisdictions.map(String)
            : ['EU', 'EEA'],
        requireVcdcDomain: Boolean(requiredZkpPredicates?.requireVcdcDomain),
      },
      maxPerCallPlt: Number(maxPerCallPlt) >= 0 ? Number(maxPerCallPlt) : 50,
      dailyAgentCapPlt: Number(dailyAgentCapPlt) >= 0 ? Number(dailyAgentCapPlt) : 500,
      x402PricePlt: Number(x402PricePlt) >= 0 ? Number(x402PricePlt) : 0.5,
      asset: 'EURt',
      sponsoredGas: sponsoredGas !== false,
      rateLimitQpm: Number(rateLimitQpm) >= 1 ? Number(rateLimitQpm) : 20,
      circuitBreakerThreshold: Number(circuitBreakerThreshold) >= 1 ? Number(circuitBreakerThreshold) : 3,
      updatedAt: new Date().toISOString(),
    };

    db.policies.push(newPolicy);

    appendAuditEntryToDb(db, {
      requestId: 'pol-' + crypto.randomUUID().slice(0, 8),
      agentDid: 'did:ccd:policy-engine',
      agentName: 'Policy Administrator',
      endpointPath: newPolicy.endpointPath,
      protocol: 'GOVERNANCE',
      decision: 'POLICY_UPDATED',
      reason: `Created new ${newPolicy.protocol} gatekeeper policy "${newPolicy.serviceName}" (${newPolicy.x402PricePlt} EURt, ${newPolicy.rateLimitQpm} QPM).`,
      zkpClaims: {
        principalVerified: true,
        ageThresholdMet: true,
        jurisdictionMatched: true,
        vcdcMatched: true,
        zkpCommitment: generateZkpCommitment({
          agentDid: 'did:ccd:policy-engine',
          endpointPath: newPolicy.endpointPath,
          principalVerified: true,
          ageThresholdMet: true,
          jurisdictionMatched: true,
          vcdcMatched: true,
          nonce: newPolicy.id,
        }),
        piiStored: false,
      },
      x402ReceiptId: null,
      amountPlt: 0,
    });

    saveDatabase(db);
    res.status(201).json({ policy: newPolicy });
  });

  app.put('/api/policies/:id', (req, res) => {
    const db = loadDatabase();
    const policy = db.policies.find((p) => p.id === req.params.id);
    if (!policy) {
      res.status(404).json({ error: 'Policy not found.' });
      return;
    }
    const patch = req.body as Partial<GatePolicy>;
    if (patch.requiredZkpPredicates) {
      policy.requiredZkpPredicates = {
        principalVerified: Boolean(patch.requiredZkpPredicates.principalVerified),
        minAge:
          patch.requiredZkpPredicates.minAge === null || patch.requiredZkpPredicates.minAge === undefined
            ? null
            : Number(patch.requiredZkpPredicates.minAge),
        allowedJurisdictions: Array.isArray(patch.requiredZkpPredicates.allowedJurisdictions)
          ? patch.requiredZkpPredicates.allowedJurisdictions.map(String)
          : policy.requiredZkpPredicates.allowedJurisdictions,
        requireVcdcDomain: Boolean(patch.requiredZkpPredicates.requireVcdcDomain),
      };
    }
    if (typeof patch.maxPerCallPlt === 'number' && patch.maxPerCallPlt >= 0) {
      policy.maxPerCallPlt = patch.maxPerCallPlt;
    }
    if (typeof patch.dailyAgentCapPlt === 'number' && patch.dailyAgentCapPlt >= 0) {
      policy.dailyAgentCapPlt = patch.dailyAgentCapPlt;
    }
    if (typeof patch.x402PricePlt === 'number' && patch.x402PricePlt >= 0) {
      policy.x402PricePlt = patch.x402PricePlt;
    }
    if (typeof patch.sponsoredGas === 'boolean') {
      policy.sponsoredGas = patch.sponsoredGas;
    }
    if (typeof patch.rateLimitQpm === 'number' && patch.rateLimitQpm >= 1) {
      policy.rateLimitQpm = Math.floor(patch.rateLimitQpm);
    }
    if (typeof patch.circuitBreakerThreshold === 'number' && patch.circuitBreakerThreshold >= 1) {
      policy.circuitBreakerThreshold = Math.floor(patch.circuitBreakerThreshold);
    }
    policy.updatedAt = new Date().toISOString();

    appendAuditEntryToDb(db, {
      requestId: 'pol-' + crypto.randomUUID().slice(0, 8),
      agentDid: 'did:ccd:policy-engine',
      agentName: 'Policy Administrator',
      endpointPath: policy.endpointPath,
      protocol: 'GOVERNANCE',
      decision: 'POLICY_UPDATED',
      reason: `Updated ZKP/x402 policy for ${policy.serviceName}: minAge=${
        policy.requiredZkpPredicates.minAge ?? 'none'
      }, jurisdictions=[${policy.requiredZkpPredicates.allowedJurisdictions.join(',')}], QPM=${policy.rateLimitQpm}, x402=${policy.x402PricePlt} EURt.`,
      zkpClaims: {
        principalVerified: true,
        ageThresholdMet: true,
        jurisdictionMatched: true,
        vcdcMatched: true,
        zkpCommitment: generateZkpCommitment({
          agentDid: 'did:ccd:policy-engine',
          endpointPath: policy.endpointPath,
          principalVerified: true,
          ageThresholdMet: true,
          jurisdictionMatched: true,
          vcdcMatched: true,
          nonce: policy.updatedAt,
        }),
        piiStored: false,
      },
      x402ReceiptId: null,
      amountPlt: 0,
    });

    saveDatabase(db);
    res.json({ policy });
  });

  app.post('/api/sandbox/probe', (req, res) => {
    const body = req.body as SandboxClaimInput;
    if (!body?.agentDid || !body?.endpointPath) {
      res.status(400).json({ error: 'agentDid and endpointPath are required.' });
      return;
    }
    const result = evaluateCompliancePipeline({
      agentDid: body.agentDid,
      endpointPath: body.endpointPath,
      jurisdictionClaim: body.jurisdictionClaim || 'EU',
      ageClaim: Number(body.ageClaim ?? 25),
      principalVerifiedClaim: body.principalVerifiedClaim !== false,
      simulateTamperedCard: Boolean(body.simulateTamperedCard),
      simulateInvalidSignature: Boolean(body.simulateInvalidSignature),
      simulateRateLimitSpike: Boolean(body.simulateRateLimitSpike),
      requestedTransferPlt: Number(body.requestedTransferPlt ?? 0),
      paymentReceiptId: body.paymentReceiptId ?? null,
      // Owner-only sandbox: the server may sign as the agent to demo the pipeline.
      allowServerSigning: true,
    }, pipelineCtx);

    Object.entries(result.headers).forEach(([k, v]) => res.setHeader(k, v));
    res.status(result.httpStatus).json(result);
  });

  // Owner-only: signs a gateway request as the agent so the sandbox can send real signed headers.
  app.post('/api/sandbox/sign', (req, res) => {
    const agentDid = String(req.body?.agentDid ?? '');
    const endpointPath = String(req.body?.endpointPath ?? '');
    if (!agentDid || !endpointPath) {
      res.status(400).json({ error: 'agentDid and endpointPath are required.' });
      return;
    }
    const db = loadDatabase();
    const agent = db.agents.find((a) => a.did === agentDid);
    if (!agent) {
      res.status(404).json({ error: 'Agent not found.' });
      return;
    }
    const privateKeyPem = db.proverKeys?.[agent.did];
    if (!privateKeyPem) {
      res.status(409).json({ error: 'No server-held key for this agent; it must sign its own requests.' });
      return;
    }
    const timestamp = new Date(now()).toISOString();
    const nonce = newAgentNonce();
    const signingPayload = agentSigningPayload(agent.did, endpointPath, timestamp, nonce, computeAgentCardHash(agent.agentCard));
    res.json({ timestamp, nonce, signatureHex: signAgentRequest(privateKeyPem, signingPayload) });
  });

  app.post('/api/x402/settle', (req, res) => {
    const { invoiceId } = req.body ?? {};
    if (!invoiceId) {
      res.status(400).json({ error: 'invoiceId is required.' });
      return;
    }
    const db = loadDatabase();
    const invoice = db.invoices.find((inv) => inv.invoiceId === invoiceId);
    if (!invoice) {
      res.status(404).json({ error: 'x402 invoice not found.' });
      return;
    }
    if (invoice.status !== 'settled') {
      invoice.status = 'settled';
      // SECURITY S3: nothing is paid or sent to the chain; the hash is a `sim_` placeholder.
      invoice.txHash = generateSimulatedTxHash(invoice.invoiceId + invoice.agentDid);
      invoice.simulated = true;
      invoice.settledAt = new Date().toISOString();
      saveDatabase(db);
    }
    res.json({ invoice });
  });

  // Real curl-able REST middleware endpoint using HTTP headers
  app.post('/api/gateway/invoke', (req, res) => {
    const agentDid = req.header('X-Concordium-Agent-DID') || '';
    const cardHashHeader = req.header('X-Agent-Card-Hash') || '';
    const signatureHeader = req.header('X-Agent-Signature') || null;
    const timestampHeader = req.header('X-Agent-Timestamp') || null;
    const nonceHeader = req.header('X-Agent-Nonce') || null;
    const jurisdictionClaim = req.header('X-ZKP-Jurisdiction') || 'EU';
    const ageClaim = Number(req.header('X-ZKP-Age') || '25');
    const paymentReceiptId = req.header('X-Payment-Receipt') || null;
    const endpointPath = String(req.body?.endpointPath || '/api/mcp/eu-sanctions-screen');
    const requestedTransferPlt = Number(req.body?.requestedTransferPlt || 0);

    if (!agentDid) {
      res.status(401).json({ error: 'Missing X-Concordium-Agent-DID header.' });
      return;
    }
    if (!signatureHeader || !timestampHeader || !nonceHeader) {
      res.status(401).json({
        error: 'Missing X-Agent-Signature, X-Agent-Timestamp or X-Agent-Nonce header; agents must sign each request.',
      });
      return;
    }

    const db = loadDatabase();
    const agent = db.agents.find((a) => a.did === agentDid);
    const simulateTamperedCard = Boolean(agent && cardHashHeader && cardHashHeader !== agent.cardHash);

    const result = evaluateCompliancePipeline({
      agentDid,
      endpointPath,
      jurisdictionClaim,
      ageClaim,
      principalVerifiedClaim: true,
      simulateTamperedCard,
      providedSignatureHex: signatureHeader,
      providedTimestamp: timestampHeader,
      providedNonce: nonceHeader,
      requestedTransferPlt,
      paymentReceiptId,
    }, pipelineCtx);

    Object.entries(result.headers).forEach(([k, v]) => res.setHeader(k, v));
    res.status(result.httpStatus).json(result);
  });

  // Standard MCP JSON-RPC 2.0 Server Endpoint
  app.post('/api/mcp', (req, res) => {
    const { jsonrpc, id, method, params } = req.body ?? {};
    const rpcId = id ?? null;

    if (jsonrpc !== '2.0' || !method) {
      res.status(400).json({
        jsonrpc: '2.0',
        id: rpcId,
        error: { code: -32600, message: 'Invalid JSON-RPC 2.0 Request' },
      });
      return;
    }

    const db = loadDatabase();
    const mcpPolicies = db.policies.filter((p) => p.protocol === 'MCP');

    if (method === 'initialize') {
      res.json({
        jsonrpc: '2.0',
        id: rpcId,
        result: {
          protocolVersion: '2024-11-05',
          serverInfo: {
            name: 'accordgate-concordium-mcp',
            version: '1.0.0',
          },
          capabilities: {
            tools: { listChanged: false },
          },
          concordiumStandards: ['CIS-8004', 'CIS-8', 'CIS-3', 'x402', 'ZKP-Zero-PII'],
          // SECURITY S3: which of the standards above are only simulated by this gateway.
          simulated: [
            'CIS-8004/CIS-8 registration (local registry, nothing written to or read from the contracts)',
            'CIS-3 gas sponsorship (no sponsored transaction)',
            'x402 settlement (no payment, sim_ hash)',
            'ZKP (self-reported claims + SHA-256 commitment, not a zero-knowledge proof)',
          ],
        },
      });
      return;
    }

    if (method === 'tools/list') {
      res.json({
        jsonrpc: '2.0',
        id: rpcId,
        result: {
          tools: mcpPolicies.map((p) => ({
            name: p.endpointPath.split('/').pop() || p.id,
            description: `${p.description} [ZKP: ${p.requiredZkpPredicates.allowedJurisdictions.join('/')}, x402: ${p.x402PricePlt.toFixed(2)} ${p.asset}]`,
            inputSchema: {
              type: 'object',
              properties: {
                targetEntity: { type: 'string', description: 'Counterparty identifier or wallet' },
                requestedTransferPlt: { type: 'number', description: 'Requested PLT transfer amount' },
              },
            },
            annotations: {
              endpointPath: p.endpointPath,
              x402PricePlt: p.x402PricePlt,
              sponsoredGas: p.sponsoredGas,
              requiredZkpPredicates: p.requiredZkpPredicates,
            },
          })),
        },
      });
      return;
    }

    if (method === 'tools/call') {
      const toolName = String(params?.name || '');
      const args = (params?.arguments ?? {}) as Record<string, unknown>;
      const matchedPolicy = mcpPolicies.find(
        (p) => p.endpointPath.split('/').pop() === toolName || p.endpointPath === toolName,
      );

      if (!matchedPolicy) {
        res.status(404).json({
          jsonrpc: '2.0',
          id: rpcId,
          error: { code: -32601, message: `Unknown MCP tool "${toolName}"` },
        });
        return;
      }

      const agentDid = req.header('X-Concordium-Agent-DID') || '';
      const cardHashHeader = req.header('X-Agent-Card-Hash') || '';
      const signatureHeader = req.header('X-Agent-Signature') || null;
      const timestampHeader = req.header('X-Agent-Timestamp') || null;
      const nonceHeader = req.header('X-Agent-Nonce') || null;
      if (!agentDid || !signatureHeader || !timestampHeader || !nonceHeader) {
        res.status(401).json({
          jsonrpc: '2.0',
          id: rpcId,
          error: {
            code: -32001,
            message: 'tools/call needs X-Concordium-Agent-DID, X-Agent-Signature, X-Agent-Timestamp and X-Agent-Nonce headers.',
          },
        });
        return;
      }
      const jurisdictionClaim = req.header('X-ZKP-Jurisdiction') || 'EU';
      const ageClaim = Number(req.header('X-ZKP-Age') || '25');
      const paymentReceiptId = req.header('X-Payment-Receipt') || null;

      const agent = db.agents.find((a) => a.did === agentDid);
      const simulateTamperedCard = Boolean(agent && cardHashHeader && cardHashHeader !== agent.cardHash);

      const pipelineResult = evaluateCompliancePipeline({
        agentDid,
        endpointPath: matchedPolicy.endpointPath,
        jurisdictionClaim,
        ageClaim,
        principalVerifiedClaim: true,
        simulateTamperedCard,
        providedSignatureHex: signatureHeader,
        providedTimestamp: timestampHeader,
        providedNonce: nonceHeader,
        requestedTransferPlt: Number(args.requestedTransferPlt ?? 0),
        paymentReceiptId,
      }, pipelineCtx);

      Object.entries(pipelineResult.headers).forEach(([k, v]) => res.setHeader(k, v));

      if (pipelineResult.httpStatus === 200) {
        res.json({
          jsonrpc: '2.0',
          id: rpcId,
          result: {
            content: [
              {
                type: 'text',
                text: JSON.stringify(pipelineResult.toolResponse, null, 2),
              },
            ],
            isError: false,
            accordGateTrace: pipelineResult.traces,
          },
        });
        return;
      }

      res.status(pipelineResult.httpStatus).json({
        jsonrpc: '2.0',
        id: rpcId,
        error: {
          code: pipelineResult.httpStatus === 402 ? -32002 : -32003,
          message:
            pipelineResult.httpStatus === 402
              ? 'x402 Payment Required before MCP tool execution'
              : `AccordGate Policy Blocked: ${pipelineResult.outcome}`,
          data: {
            httpStatus: pipelineResult.httpStatus,
            outcome: pipelineResult.outcome,
            invoice: 'invoice' in pipelineResult ? pipelineResult.invoice : undefined,
            traces: pipelineResult.traces,
          },
        },
      });
      return;
    }

    res.status(400).json({
      jsonrpc: '2.0',
      id: rpcId,
      error: { code: -32601, message: `Unsupported MCP method "${method}"` },
    });
  });

  app.get('/api/audit', (req, res) => {
    const db = loadDatabase();
    const decision = String(req.query.decision || 'all');
    const search = String(req.query.q || '').trim().toLowerCase();

    let logs = [...db.auditLogs].reverse();
    if (decision === 'allowed') {
      logs = logs.filter((l) => l.decision === 'ALLOWED');
    } else if (decision === 'blocked') {
      logs = logs.filter((l) => l.decision.startsWith('BLOCKED_') || l.decision === 'PAYMENT_REQUIRED');
    } else if (decision === 'governance') {
      logs = logs.filter((l) => l.protocol === 'GOVERNANCE');
    }

    if (search) {
      logs = logs.filter(
        (l) =>
          l.agentDid.toLowerCase().includes(search) ||
          l.agentName.toLowerCase().includes(search) ||
          l.endpointPath.toLowerCase().includes(search) ||
          l.requestId.toLowerCase().includes(search) ||
          l.entryHash.toLowerCase().includes(search),
      );
    }

    const chainStatus = verifyAuditHashChain(db.auditLogs);
    res.json({ logs, chainStatus, tamperDemoActive: Boolean(db.tamperBackup) });
  });

  app.get('/api/audit/verify', (_req, res) => {
    const db = loadDatabase();
    const chainStatus = verifyAuditHashChain(db.auditLogs);
    res.json({ ...chainStatus, tamperDemoActive: Boolean(db.tamperBackup) });
  });

  // Tamper demonstration: modifies an audit entry's amount without recomputing hashes, then lets verifier catch it
  app.post('/api/audit/simulate-tamper', (_req, res) => {
    const db = loadDatabase();
    if (db.auditLogs.length === 0) {
      res.status(400).json({ error: 'No audit logs available to tamper.' });
      return;
    }
    if (!db.tamperBackup) {
      db.tamperBackup = JSON.parse(JSON.stringify(db.auditLogs)) as AuditEntry[];
    }
    const targetIdx = Math.max(0, db.auditLogs.length - 2);
    db.auditLogs[targetIdx].amountPlt = Number((db.auditLogs[targetIdx].amountPlt + 999.99).toFixed(2));
    db.auditLogs[targetIdx].reason = '[TAMPERED RECORD] ' + db.auditLogs[targetIdx].reason;
    saveDatabase(db);

    const chainStatus = verifyAuditHashChain(db.auditLogs);
    dispatchWebhooks('audit.tamper_detected', {
      brokenAtSeq: chainStatus.brokenAtSeq,
      tamperedSeq: db.auditLogs[targetIdx].seq,
    });
    res.json({ ...chainStatus, tamperDemoActive: true, tamperedSeq: db.auditLogs[targetIdx].seq });
  });

  app.post('/api/audit/restore-tamper', (_req, res) => {
    const db = loadDatabase();
    if (db.tamperBackup) {
      db.auditLogs = db.tamperBackup;
      db.tamperBackup = null;
      saveDatabase(db);
    }
    const chainStatus = verifyAuditHashChain(db.auditLogs);
    res.json({ ...chainStatus, tamperDemoActive: false });
  });

  // Webhooks Management & Live Test Dispatch
  app.get('/api/webhooks', (_req, res) => {
    const db = loadDatabase();
    // The signing secret is shown once on creation; reads only get a masked preview.
    res.json({ webhooks: (db.webhooks ?? []).map(maskWebhookSecret), deliveries: db.webhookDeliveries ?? [] });
  });

  app.post('/api/webhooks', (req, res) => {
    const { label, url, enabledEvents } = req.body ?? {};
    if (!label || !url) {
      res.status(400).json({ error: 'label and url are required.' });
      return;
    }
    const parsedUrl = String(url).trim();
    if (!parsedUrl.startsWith('http://') && !parsedUrl.startsWith('https://')) {
      res.status(400).json({ error: 'Webhook url must start with http:// or https://' });
      return;
    }

    const db = loadDatabase();
    const now = new Date().toISOString();
    const wh: WebhookConfig = {
      id: 'wh-' + crypto.randomUUID().slice(0, 8),
      label: String(label).trim(),
      url: parsedUrl,
      enabledEvents:
        Array.isArray(enabledEvents) && enabledEvents.length > 0
          ? (enabledEvents.slice(0, 10) as WebhookEventType[])
          : ['agent.revoked', 'agent.cascade_revoked', 'circuit_breaker.opened', 'audit.tamper_detected'],
      active: true,
      signingSecretPreview: 'whsec_' + crypto.randomBytes(6).toString('hex'),
      lastStatusCode: null,
      lastDeliveredAt: null,
      createdAt: now,
      updatedAt: now,
    };
    db.webhooks.unshift(wh);
    saveDatabase(db);
    res.status(201).json({ webhook: wh });
  });

  app.delete('/api/webhooks/:id', (req, res) => {
    const db = loadDatabase();
    db.webhooks = db.webhooks.filter((w) => w.id !== req.params.id);
    saveDatabase(db);
    res.json({ deleted: true });
  });

  app.post('/api/webhooks/:id/test', async (req, res) => {
    const db = loadDatabase();
    const wh = db.webhooks.find((w) => w.id === req.params.id);
    if (!wh) {
      res.status(404).json({ error: 'Webhook not found.' });
      return;
    }
    const start = Date.now();
    const bodyStr = JSON.stringify({
      event: 'accordgate.test_ping',
      timestamp: new Date().toISOString(),
      webhookId: wh.id,
      message: 'AccordGate EU AI Act & Concordium compliance webhook connectivity test.',
    });
    const signature = crypto
      .createHmac('sha256', wh.signingSecretPreview)
      .update(bodyStr)
      .digest('hex');

    let statusCode: number | null = null;
    let ok = false;
    let detail = '';
    try {
      const resp = await fetch(wh.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-AccordGate-Event': 'accordgate.test_ping',
          'X-AccordGate-Signature': `sha256=${signature}`,
        },
        body: bodyStr,
        signal: AbortSignal.timeout(4500),
      });
      statusCode = resp.status;
      ok = resp.ok;
      detail = `HTTP ${resp.status} ${resp.statusText || ''}`.trim();
    } catch (err) {
      detail = err instanceof Error ? err.message : 'Request failed';
    }

    const deliveredAt = new Date().toISOString();
    wh.lastStatusCode = statusCode ?? 0;
    wh.lastDeliveredAt = deliveredAt;
    wh.updatedAt = deliveredAt;

    const delivery = {
      id: 'del-' + crypto.randomUUID().slice(0, 8),
      webhookId: wh.id,
      webhookLabel: wh.label,
      eventType: 'accordgate.test_ping',
      statusCode,
      ok,
      latencyMs: Date.now() - start,
      detail,
      deliveredAt,
    };
    db.webhookDeliveries.unshift(delivery);
    db.webhookDeliveries = db.webhookDeliveries.slice(0, 25);
    saveDatabase(db);
    res.json({ delivery, webhook: wh });
  });

  // Concordium On-Chain Audit Root Anchors
  app.get('/api/anchors', (_req, res) => {
    const db = loadDatabase();
    res.json({ anchors: db.onchainAnchors ?? [] });
  });

  app.post('/api/anchors', (req, res) => {
    const { signerAddress, txHash, mode } = req.body ?? {};
    const db = loadDatabase();
    const latestEntry = db.auditLogs[db.auditLogs.length - 1];
    const rootHash = latestEntry?.entryHash ?? '0'.repeat(64);
    const auditRange = latestEntry ? `#1 — #${latestEntry.seq}` : '#0';
    // SECURITY S3: a wallet mode counts only with a signer and a 64-hex hash (a Concordium tx hash
    // or a SHA-256 signature digest); anything else is stored as simulated, with no signer and a
    // `sim_` hash. browser-wallet-tx is the wallet's report and is not looked up on chain by the server.
    const claimedSigner = typeof signerAddress === 'string' ? signerAddress.trim() : '';
    const claimedHash = typeof txHash === 'string' ? txHash.trim() : '';
    const anchorMode: OnchainAnchorRecord['mode'] =
      (mode === 'browser-wallet-tx' || mode === 'wallet-signed-attestation') &&
      claimedSigner &&
      /^[0-9a-f]{64}$/i.test(claimedHash)
        ? mode
        : 'simulated-payload';
    const simulatedAnchor = anchorMode === 'simulated-payload';
    const onChain = anchorMode === 'browser-wallet-tx';
    const anchor: OnchainAnchorRecord = {
      id: 'anc-' + crypto.randomUUID().slice(0, 8),
      rootHash,
      auditRange,
      totalEntries: db.auditLogs.length,
      signerAddress: simulatedAnchor ? null : claimedSigner,
      txHash: simulatedAnchor ? generateSimulatedTxHash(rootHash + Date.now()) : claimedHash,
      network: 'testnet',
      mode: anchorMode,
      createdAt: new Date().toISOString(),
    };
    db.onchainAnchors.unshift(anchor);
    const anchorReason = onChain
      ? `Anchored EU AI Act audit root (${rootHash.slice(0, 14)}...) for entries ${auditRange} on Concordium Testnet via RegisterData (tx reported by the wallet, not checked by the server).`
      : anchorMode === 'wallet-signed-attestation'
        ? `Wallet signed the EU AI Act audit root (${rootHash.slice(0, 14)}...) for entries ${auditRange}; signature digest only, not on chain.`
        : `Simulated anchor of EU AI Act audit root (${rootHash.slice(0, 14)}...) for entries ${auditRange}; nothing signed or sent to the chain.`;

    appendAuditEntryToDb(db, {
      requestId: 'anc-' + crypto.randomUUID().slice(0, 8),
      agentDid: 'did:ccd:audit-anchorer',
      agentName: 'Concordium Anchor Service',
      endpointPath: '/registry/concordium-anchor',
      protocol: 'GOVERNANCE',
      decision: onChain ? 'ONCHAIN_ANCHORED' : 'ANCHOR_NOT_ONCHAIN',
      reason: anchorReason,
      zkpClaims: {
        principalVerified: true,
        ageThresholdMet: true,
        jurisdictionMatched: true,
        vcdcMatched: true,
        zkpCommitment: rootHash,
        piiStored: false,
      },
      x402ReceiptId: anchor.txHash,
      amountPlt: 0,
    });

    saveDatabase(db);
    dispatchWebhooks('audit.anchored', {
      anchorId: anchor.id,
      rootHash: anchor.rootHash,
      txHash: anchor.txHash,
      signerAddress: anchor.signerAddress,
      mode: anchor.mode,
      // SECURITY S3: the event fires for every mode; these fields say what actually happened.
      simulated: simulatedAnchor,
      reportedOnChainByWallet: onChain,
      serverVerifiedOnChain: false,
    });
    res.status(201).json({ anchor });
  });

  app.get('/api/audit/export', (req, res) => {
    const db = loadDatabase();
    const format = req.query.format === 'csv' ? 'csv' : 'json';
    const chainStatus = verifyAuditHashChain(db.auditLogs);

    if (format === 'csv') {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="eu-ai-act-audit-report.csv"');
      res.send(toCsv(db.auditLogs));
      return;
    }

    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="eu-ai-act-audit-report.json"');
    res.json({
      reportStandard: 'EU AI Act Article 12 & Article 14 Compliance Record',
      exportedAt: new Date().toISOString(),
      chainIntegrity: chainStatus,
      piiStored: false,
      totalRecords: db.auditLogs.length,
      records: db.auditLogs,
    });
  });

  // Live Concordium Testnet gRPC Queries using @concordium/web-sdk
  app.post('/api/testnet/probe', async (_req, res) => {
    const start = Date.now();
    try {
      const client = createTestnetGrpcClient();
      const status = await client.getConsensusStatus();
      const [cis8004, cis8] = await Promise.allSettled([
        client.getInstanceInfo(ContractAddress.create(10082n, 0n)),
        client.getInstanceInfo(ContractAddress.create(10081n, 0n)),
      ]);
      const latencyMs = Date.now() - start;

      const formatContract = (
        idx: string,
        settled: PromiseSettledResult<Awaited<ReturnType<typeof client.getInstanceInfo>>>,
      ) => {
        if (settled.status === 'fulfilled') {
          return {
            address: idx,
            found: true,
            name: settled.value.name?.value ?? 'init_contract',
            methods: (settled.value.methods ?? []).map((m) => m.value).slice(0, 6),
            amountCcd: Number(settled.value.amount?.microCcdAmount ?? 0n) / 1_000_000,
          };
        }
        return { address: idx, found: false, error: String(settled.reason) };
      };

      res.json({
        network: 'Concordium Testnet',
        endpoint: `${TESTNET_GRPC_HOST}:${TESTNET_GRPC_PORT}`,
        reachable: true,
        latencyMs,
        mode: 'live-grpc-testnet',
        checkedAt: new Date().toISOString(),
        consensus: {
          bestBlockHeight: status.bestBlockHeight.toString(),
          lastFinalizedBlockHeight: status.lastFinalizedBlockHeight.toString(),
          bestBlock: status.bestBlock.toString(),
          protocolVersion: status.protocolVersion.toString(),
        },
        contracts: {
          cis8004: formatContract('10082:0', cis8004),
          cis8: formatContract('10081:0', cis8),
        },
        detail: `已通过 @concordium/web-sdk 直连 Concordium Testnet，最新区块高度 #${status.bestBlockHeight.toString()}（Protocol v${status.protocolVersion.toString()}）。`,
      });
    } catch (err) {
      res.json({
        network: 'Concordium Testnet',
        endpoint: `${TESTNET_GRPC_HOST}:${TESTNET_GRPC_PORT}`,
        reachable: false,
        latencyMs: Date.now() - start,
        mode: 'unreachable',
        checkedAt: new Date().toISOString(),
        detail: `Testnet gRPC 暂不可达 (${err instanceof Error ? err.message : 'Network error'})；未读取到链上状态。`,
      });
    }
  });

  app.post('/api/testnet/inspect', async (req, res) => {
    const target = String(req.body?.target || '').trim();
    if (!target) {
      res.status(400).json({ error: 'target is required (e.g. 10082:0 or Base58 account address).' });
      return;
    }

    const start = Date.now();
    try {
      const client = createTestnetGrpcClient();

      // Contract format: "<index>:<subindex>" or numeric index
      const contractMatch = /^(\d+)(?::(\d+))?$/.exec(target);
      if (contractMatch) {
        const index = BigInt(contractMatch[1]);
        const subindex = BigInt(contractMatch[2] ?? '0');
        const info = await client.getInstanceInfo(ContractAddress.create(index, subindex));
        res.json({
          type: 'contract',
          target: `${index.toString()}:${subindex.toString()}`,
          latencyMs: Date.now() - start,
          ccdScanUrl: `https://testnet.ccdscan.io/?dcount=1&dentity=contract&daddressIndex=${index.toString()}&daddressSubIndex=${subindex.toString()}`,
          data: {
            name: info.name?.value,
            owner: info.owner?.address,
            amountCcd: Number(info.amount?.microCcdAmount ?? 0n) / 1_000_000,
            sourceModule: info.sourceModule?.toString(),
            methods: (info.methods ?? []).map((m) => m.value),
          },
        });
        return;
      }

      // Base58 Account Address
      const accountAddr = AccountAddress.fromBase58(target);
      const acctInfo = await client.getAccountInfo(accountAddr);
      res.json({
        type: 'account',
        target,
        latencyMs: Date.now() - start,
        ccdScanUrl: `https://testnet.ccdscan.io/?dcount=1&dentity=account&daddress=${encodeURIComponent(target)}`,
        data: {
          address: acctInfo.accountAddress.address,
          amountCcd: Number(acctInfo.accountAmount.microCcdAmount) / 1_000_000,
          nonce: acctInfo.accountNonce.value.toString(),
          credentialCount: Object.keys(acctInfo.accountCredentials ?? {}).length,
        },
      });
    } catch (err) {
      res.status(400).json({
        error: err instanceof Error ? err.message : 'Testnet query failed',
      });
    }
  });

  app.post('/api/sandbox/reset', (_req, res) => {
    rateLimitBuckets.clear();
    const fresh = resetDatabase();
    res.json({ status: 'reset', agents: fresh.agents.length, policies: fresh.policies.length, auditLogs: fresh.auditLogs.length });
  });

  return app;
}

async function startServer() {
  const ownerAccounts = parseOwnerAccounts(process.env.OWNER_ACCOUNTS);
  if (ownerAccounts.length === 0) {
    console.warn('[auth] OWNER_ACCOUNTS is not set: every change to the gateway is refused until it is.');
  }
  const app = createApp({
    ownerAccounts,
    getAccountInfo: getTestnetAccountInfo,
    secureCookie: process.env.NODE_ENV === 'production',
  });

  const isProd = process.env.NODE_ENV === 'production' && fs.existsSync(path.resolve(process.cwd(), 'dist'));
  if (isProd) {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  } else {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`AccordGate server listening on http://0.0.0.0:${PORT}`);
  });
}

// Start only when run directly (`tsx server.ts`), not when tests import createApp.
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  startServer().catch((err) => {
    console.error('Failed to start AccordGate server:', err);
    process.exit(1);
  });
}
