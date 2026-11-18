import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  message: string;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    let readable = error.message || '应用运行时出现异常';
    try {
      const parsed = JSON.parse(error.message) as { error?: string; operationType?: string; path?: string };
      if (parsed && parsed.error) {
        readable = `云端同步权限或网络异常 (${parsed.operationType ?? 'read'} ${parsed.path ?? ''}): ${parsed.error}`;
      }
    } catch {
      // Not a structured FirestoreErrorInfo JSON string
    }
    return { hasError: true, message: readable };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('AccordGate UI Boundary caught error:', error, info);
  }

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 p-6 dark:bg-slate-950">
        <div className="w-full max-w-md rounded-lg border border-red-200 bg-white p-6 dark:border-red-900 dark:bg-slate-900">
          <div className="flex items-center gap-2 text-red-700 dark:text-red-400">
            <AlertTriangle className="h-5 w-5 shrink-0" />
            <h2 className="text-base font-semibold">控制台捕获到运行时异常</h2>
          </div>
          <p className="mt-3 text-xs leading-relaxed text-slate-600 dark:text-slate-300">{this.state.message}</p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="mt-5 inline-flex items-center gap-2 rounded-md bg-blue-700 px-4 py-2 text-xs font-medium text-white hover:bg-blue-800"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            <span>重新加载控制台</span>
          </button>
        </div>
      </div>
    );
  }
}
