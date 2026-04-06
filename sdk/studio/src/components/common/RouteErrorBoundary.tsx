import React from 'react';
import { useRouteError, isRouteErrorResponse } from 'react-router-dom';
import { logger } from '@/utils/logger';

/**
 * Route Error Boundary Component
 *
 * Handles errors that occur during routing
 */
export function RouteErrorBoundary() {
  const error = useRouteError();

  // Log the error
  React.useEffect(() => {
    logger.error('Route error:', error);
  }, [error]);

  // Handle different types of errors
  if (isRouteErrorResponse(error)) {
    if (error.status === 404) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900 px-4">
          <div className="max-w-md w-full text-center space-y-6">
            <h1 className="text-9xl font-bold text-gray-300 dark:text-gray-700">404</h1>
            <h2 className="text-3xl font-bold text-gray-900 dark:text-white">
              Page Not Found
            </h2>
            <p className="text-gray-600 dark:text-gray-400">
              The page you're looking for doesn't exist or has been moved.
            </p>
            <button
              onClick={() => window.location.href = '/'}
              className="px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition-colors"
            >
              Go to Home
            </button>
          </div>
        </div>
      );
    }

    if (error.status === 401) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900 px-4">
          <div className="max-w-md w-full text-center space-y-6">
            <h1 className="text-6xl font-bold text-yellow-500 mb-4">🔒</h1>
            <h2 className="text-3xl font-bold text-gray-900 dark:text-white">
              Unauthorized
            </h2>
            <p className="text-gray-600 dark:text-gray-400">
              You don't have permission to access this page.
            </p>
            <button
              onClick={() => window.location.href = '/login'}
              className="px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition-colors"
            >
              Go to Login
            </button>
          </div>
        </div>
      );
    }

    if (error.status === 503) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900 px-4">
          <div className="max-w-md w-full text-center space-y-6">
            <h1 className="text-6xl font-bold text-orange-500 mb-4">🔧</h1>
            <h2 className="text-3xl font-bold text-gray-900 dark:text-white">
              Service Unavailable
            </h2>
            <p className="text-gray-600 dark:text-gray-400">
              The service is temporarily unavailable. Please try again later.
            </p>
            <button
              onClick={() => window.location.reload()}
              className="px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition-colors"
            >
              Retry
            </button>
          </div>
        </div>
      );
    }
  }

  // Generic error fallback
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900 px-4">
      <div className="max-w-md w-full text-center space-y-6">
        <h1 className="text-6xl font-bold text-red-500 mb-4">⚠️</h1>
        <h2 className="text-3xl font-bold text-gray-900 dark:text-white">
          Something went wrong
        </h2>
        <p className="text-gray-600 dark:text-gray-400">
          An unexpected error occurred. Please try again.
        </p>

        {process.env.NODE_ENV === 'development' && error instanceof Error && (
          <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4 text-left">
            <h3 className="text-sm font-semibold text-red-800 dark:text-red-200 mb-2">
              Error Details (Development Only):
            </h3>
            <pre className="text-xs text-red-700 dark:text-red-300 overflow-auto max-h-40">
              {error.message}
              {error.stack && `\n\n${error.stack}`}
            </pre>
          </div>
        )}

        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <button
            onClick={() => window.location.reload()}
            className="px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition-colors"
          >
            Reload Page
          </button>
          <button
            onClick={() => window.location.href = '/'}
            className="px-6 py-3 bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-900 dark:text-white font-medium rounded-lg transition-colors"
          >
            Go to Home
          </button>
        </div>
      </div>
    </div>
  );
}
