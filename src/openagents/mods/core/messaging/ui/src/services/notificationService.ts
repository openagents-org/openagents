/**
 * Universal Notification Service
 *
 * Provides system notifications with automatic fallback to in-browser notifications
 * for environments that don't support the Notifications API (HTTP, older browsers)
 */

interface NotificationConfig {
  title: string;
  body: string;
  icon?: string;
  channel?: string;
  sender?: string;
  timestamp?: number;
}

class UniversalNotificationService {
  private permission: NotificationPermission = 'default';
  private isInitialized = false;

  /**
   * Check system notification support and request permission
   */
  async checkSystemNotificationSupport(): Promise<boolean> {
    if (!('Notification' in window)) {
      console.log('Browser does not support notifications');
      return false;
    }

    try {
      // Check if we're in a secure context (HTTPS or localhost)
      const isSecureContext = window.isSecureContext ||
                              window.location.protocol === 'https:' ||
                              window.location.hostname === 'localhost' ||
                              window.location.hostname === '127.0.0.1';

      if (!isSecureContext) {
        console.log('Notifications require secure context (HTTPS or localhost)');
        return false;
      }

      this.permission = await Notification.requestPermission();
      console.log('Notification permission:', this.permission);
      return this.permission === 'granted';
    } catch (error) {
      console.warn('System notifications not supported:', error);
      return false;
    }
  }

  /**
   * Show system notification using the Notifications API
   */
  private showSystemNotification(config: NotificationConfig): Notification | null {
    console.log('🔔 showSystemNotification called with:', {
      permission: this.permission,
      actualPermission: Notification.permission,
      config: config
    });

    // 同步权限状态
    this.permission = Notification.permission;

    if (this.permission !== 'granted') {
      console.log('🚫 Notification permission not granted:', this.permission);
      return null;
    }

    try {
      console.log('🔔 Creating system notification...');
      const notification = new Notification(config.title, {
        body: config.body,
        icon: config.icon || '/favicon.ico',
        tag: `chat-${config.channel || 'general'}`,
        requireInteraction: false,
        silent: false,
        data: {
          channel: config.channel,
          sender: config.sender,
          timestamp: config.timestamp
        }
      });

      console.log('✅ System notification created successfully');

      // Click to focus window
      notification.onclick = () => {
        window.focus();
        notification.close();
        // Navigate to the relevant channel if needed
        if (config.channel || config.sender) {
          const event = new CustomEvent('notification-click', {
            detail: { channel: config.channel, sender: config.sender }
          });
          window.dispatchEvent(event);
        }
      };

      // Auto close after 5 seconds
      setTimeout(() => notification.close(), 5000);

      return notification;
    } catch (error) {
      console.error('❌ Failed to create system notification:', error);
      return null;
    }
  }

  /**
   * Check if notifications should be shown (always show notifications now)
   */
  private shouldShowNotification(): boolean {
    // 移除窗口活跃状态检查，始终显示通知
    return true;
  }

  /**
   * Main notification method - only uses system notifications
   */
  async showNotification(config: NotificationConfig) {
    // Only show notifications when window is not active
    if (!this.shouldShowNotification()) {
      console.log('Window is active, skipping notification');
      return;
    }

    // Only try system notification
    const systemNotification = this.showSystemNotification(config);

    if (systemNotification) {
      console.log('Showed system notification');
    } else {
      console.log('System notification not supported or permission denied');
    }
  }

  /**
   * Chat message specific notification for channel messages
   */
  async showChatNotification(senderName: string, channel: string, message: string, message_type: string) {
    // Truncate long messages
    const truncatedMessage = message.length > 100
      ? message.substring(0, 97) + '...'
      : message;

    const isDirectMessage = !(message_type === "channel_message" || message_type === "reply_message");

    await this.showNotification({
      title: `new message from ${senderName}`,
      body: `in #${!isDirectMessage ? channel : senderName}: ${truncatedMessage}`,
      channel: !isDirectMessage ? channel : "",
      sender: senderName,
      timestamp: Date.now()
    });
  }

  /**
   * Direct message specific notification
   */
  async showDirectMessageNotification(senderName: string, message: string) {
    // Truncate long messages
    const truncatedMessage = message.length > 100
      ? message.substring(0, 97) + '...'
      : message;

    await this.showNotification({
      title: `direct message from ${senderName}`,
      body: truncatedMessage,
      sender: senderName,
      timestamp: Date.now()
    });
  }

  /**
   * Mention notification for when user is @mentioned in a channel
   */
  async showMentionNotification(senderName: string, channel: string, message: string) {
    // Truncate long messages
    const truncatedMessage = message.length > 100
      ? message.substring(0, 97) + '...'
      : message;

    await this.showNotification({
      title: `${senderName} in #${channel} mentioned you`,
      body: truncatedMessage,
      channel,
      sender: senderName,
      timestamp: Date.now()
    });
  }

  /**
   * Reply notification for when someone replies to user's message
   */
  async showReplyNotification(senderName: string, channel: string, message: string) {
    // Truncate long messages
    const truncatedMessage = message.length > 100
      ? message.substring(0, 97) + '...'
      : message;

    const title = channel
      ? `${senderName} replied to your message in #${channel}`
      : `${senderName} replied to your direct message`;

    await this.showNotification({
      title,
      body: truncatedMessage,
      channel,
      sender: senderName,
      timestamp: Date.now()
    });
  }

  /**
   * Initialize the notification service
   */
  async initialize(): Promise<boolean> {
    if (this.isInitialized) return this.permission === 'granted';

    this.isInitialized = true;
    const supported = await this.checkSystemNotificationSupport();

    console.log('Notification service initialized:', {
      systemSupported: supported,
      permission: this.permission,
    });

    return supported;
  }

  /**
   * Get current notification status
   */
  getStatus() {
    return {
      systemSupported: 'Notification' in window && this.permission === 'granted',
      permission: this.permission,
      isInitialized: this.isInitialized
    };
  }

  /**
   * Get current notification permission status
   */
  getPermissionStatus(): NotificationPermission {
    if ('Notification' in window) {
      this.permission = Notification.permission;
      return this.permission;
    }
    return 'denied';
  }

  /**
   * Check if notifications are supported by the browser
   */
  isNotificationSupported(): boolean {
    return 'Notification' in window;
  }

  /**
   * Check if we're in a secure context (required for notifications)
   */
  isSecureContext(): boolean {
    return window.isSecureContext ||
           window.location.protocol === 'https:' ||
           window.location.hostname === 'localhost' ||
           window.location.hostname === '127.0.0.1';
  }

  /**
   * Check if the user has chosen "never show again" for permission requests
   */
  hasUserOptedOutOfPermissionRequests(): boolean {
    try {
      return localStorage.getItem('notification-permission-never-show') === 'true';
    } catch {
      return false;
    }
  }

  /**
   * Set the user's preference to never show permission requests again
   */
  setNeverShowPermissionRequest(): void {
    try {
      localStorage.setItem('notification-permission-never-show', 'true');
    } catch (error) {
      console.warn('Failed to save notification preference:', error);
    }
  }

  /**
   * Reset the user's permission request preference (for testing or user settings)
   */
  resetPermissionRequestPreference(): void {
    try {
      localStorage.removeItem('notification-permission-never-show');
    } catch (error) {
      console.warn('Failed to reset notification preference:', error);
    }
  }

  /**
   * Check if the permission overlay should be shown
   * This is a convenience method that combines all the checks
   */
  shouldShowPermissionOverlay(currentPath: string): boolean {
    // Only show on messaging pages
    const isMessagingPage = currentPath === '/messaging' || currentPath.startsWith('/messaging/');

    // Don't show if user opted out
    if (this.hasUserOptedOutOfPermissionRequests()) {
      return false;
    }

    // Don't show if notifications not supported
    if (!this.isNotificationSupported()) {
      return false;
    }

    // Don't show if not in secure context
    if (!this.isSecureContext()) {
      return false;
    }

    // Don't show if permission already granted
    const permission = this.getPermissionStatus();
    if (permission === 'granted') {
      return false;
    }

    return isMessagingPage && (permission === 'default' || permission === 'denied');
  }
}

// Export singleton instance
export const notificationService = new UniversalNotificationService();

