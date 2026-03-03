import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { AppColors, BorderRadius, Spacing } from '../constants/theme';
import { error as logError, openCrashReportEmail } from '../utils/logger';

interface ErrorBoundaryProps {
  children: React.ReactNode;
  fallback?: React.ReactNode;
  onDismiss?: () => void;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  componentStack: string | null;
}

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null, componentStack: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error, componentStack: null };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    logError('ErrorBoundary caught: ' + error?.message, { error, componentStack: errorInfo.componentStack });
    this.setState({ componentStack: errorInfo.componentStack ?? null });
  }

  handleReload = () => {
    this.setState({ hasError: false, error: null, componentStack: null });
    this.props.onDismiss?.();
  };

  handleReport = () => {
    openCrashReportEmail(this.state.error, this.state.componentStack);
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <View style={errorStyles.container}>
          <View style={errorStyles.content}>
            <Ionicons name="bug-outline" size={48} color={AppColors.secondary} />
            <Text style={errorStyles.title}>Something went wrong</Text>
            <Text style={errorStyles.message}>
              {this.state.error?.message || 'An unexpected error occurred'}
            </Text>
            <TouchableOpacity style={errorStyles.button} onPress={this.handleReload}>
              <Ionicons name="refresh" size={18} color={AppColors.primary} />
              <Text style={errorStyles.buttonText}>Reload App</Text>
            </TouchableOpacity>
            <TouchableOpacity style={errorStyles.reportButton} onPress={this.handleReport}>
              <Ionicons name="mail-outline" size={16} color={AppColors.secondary} />
              <Text style={errorStyles.reportButtonText}>Report Issue</Text>
            </TouchableOpacity>
          </View>
          <Text style={errorStyles.copyright}>Tracky - Made with &lt;3 by Jason</Text>
        </View>
      );
    }

    return this.props.children;
  }
}

const errorStyles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
    justifyContent: 'center',
    alignItems: 'center',
  },
  content: {
    alignItems: 'center',
    paddingHorizontal: Spacing.xxl,
    gap: Spacing.sm,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: AppColors.primary,
    marginTop: Spacing.lg,
  },
  message: {
    fontSize: 13,
    color: AppColors.secondary,
    textAlign: 'center',
    lineHeight: 18,
  },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    backgroundColor: AppColors.background.tertiary,
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.sm,
    marginTop: Spacing.xl,
  },
  buttonText: {
    fontSize: 14,
    fontWeight: '600',
    color: AppColors.primary,
  },
  reportButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    marginTop: Spacing.md,
  },
  reportButtonText: {
    fontSize: 13,
    color: AppColors.secondary,
  },
  copyright: {
    position: 'absolute',
    bottom: '15%',
    color: AppColors.secondary,
    fontSize: 12,
    fontWeight: '400',
    opacity: 0.6,
  },
});
