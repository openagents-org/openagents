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
  private fallbackContainer: HTMLElement | null = null;
  private isInitialized = false;


  // /**
  //  * Initialize the fallback notification container for in-browser notifications
  //  */
  // private initFallbackContainer() {
  //   if (typeof window !== 'undefined' && !this.fallbackContainer) {
  //     this.fallbackContainer = document.createElement('div');
  //     this.fallbackContainer.id = 'notification-container';
  //     this.fallbackContainer.style.cssText = `
  //       position: fixed;
  //       top: 20px;
  //       right: 20px;
  //       z-index: 10000;
  //       pointer-events: none;
  //       max-height: 80vh;
  //       overflow-y: auto;
  //     `;
  //     document.body.appendChild(this.fallbackContainer);
  //     this.addNotificationStyles();
  //   }
  // }

  // /**
  //  * Add CSS styles for in-browser notifications
  //  */
  // private addNotificationStyles() {
  //   if (!document.getElementById('notification-styles')) {
  //     const style = document.createElement('style');
  //     style.id = 'notification-styles';
  //     style.textContent = `
  //       @keyframes slideIn {
  //         from {
  //           transform: translateX(100%);
  //           opacity: 0;
  //         }
  //         to {
  //           transform: translateX(0);
  //           opacity: 1;
  //         }
  //       }

  //       @keyframes slideOut {
  //         from {
  //           transform: translateX(0);
  //           opacity: 1;
  //         }
  //         to {
  //           transform: translateX(100%);
  //           opacity: 0;
  //         }
  //       }

  //       .notification-item {
  //         background: linear-gradient(135deg, #1a1a1a 0%, #2d2d2d 100%);
  //         color: white;
  //         padding: 16px;
  //         border-radius: 12px;
  //         /* margin-bottom: 12px; */
  //         box-shadow: 0 8px 32px rgba(0,0,0,0.4);
  //         max-width: 350px;
  //         pointer-events: auto;
  //         cursor: pointer;
  //         border-left: 4px solid #007acc;
  //         animation: slideIn 0.4s cubic-bezier(0.23, 1, 0.320, 1);
  //         backdrop-filter: blur(10px);
  //         border: 1px solid rgba(255,255,255,0.1);
  //       }

  //       .notification-item:hover {
  //         transform: translateX(-4px);
  //         box-shadow: 0 12px 40px rgba(0,0,0,0.5);
  //         transition: all 0.2s ease;
  //       }

  //       .notification-title {
  //         font-weight: 600;
  //         font-size: 14px;
  //         margin-bottom: 6px;
  //         color: #ffffff;
  //       }

  //       .notification-body {
  //         font-size: 13px;
  //         opacity: 0.9;
  //         line-height: 1.4;
  //         color: #e0e0e0;
  //       }

  //       .notification-meta {
  //         font-size: 11px;
  //         opacity: 0.7;
  //         margin-top: 8px;
  //         color: #a0a0a0;
  //         display: flex;
  //         justify-content: space-between;
  //         align-items: center;
  //       }

  //       .notification-close {
  //         background: none;
  //         border: none;
  //         color: #a0a0a0;
  //         cursor: pointer;
  //         font-size: 16px;
  //         padding: 0;
  //         width: 20px;
  //         height: 20px;
  //         display: flex;
  //         align-items: center;
  //         justify-content: center;
  //         border-radius: 50%;
  //         transition: all 0.2s ease;
  //       }

  //       .notification-close:hover {
  //         background: rgba(255,255,255,0.1);
  //         color: #ffffff;
  //       }
  //     `;
  //     document.head.appendChild(style);
  //   }
  // }

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

    // Sync permission status
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
      console.error('🔍 Error details:', {
        errorMessage: error instanceof Error ? error.message : 'Unknown error',
        notificationSupport: 'Notification' in window,
        permission: this.permission,
        actualPermission: Notification.permission,
        isSecureContext: this.isSecureContext()
      });
      return null;
    }
  }

  // /**
  //  * Show in-browser notification as fallback
  //  */
  // private showInBrowserNotification(config: NotificationConfig) {
  //   if (!this.fallbackContainer) {
  //     this.initFallbackContainer();
  //   }
  //   if (!this.fallbackContainer) return;

  //   const notificationEl = document.createElement('div');
  //   notificationEl.className = 'notification-item';

  //   const formattedTime = new Date(config.timestamp || Date.now()).toLocaleTimeString([], {
  //     hour: '2-digit',
  //     minute: '2-digit'
  //   });

  //   notificationEl.innerHTML = `
  //     <div class="notification-title">
  //       ${this.escapeHtml(config.title)}
  //     </div>
  //     <div class="notification-body">
  //       ${this.escapeHtml(config.body)}
  //     </div>
  //     <div class="notification-meta">
  //       <span>${formattedTime}</span>
  //       <button class="notification-close" aria-label="Close">&times;</button>
  //     </div>
  //   `;

  //   // Click to focus and close
  //   notificationEl.onclick = (e) => {
  //     if ((e.target as HTMLElement).classList.contains('notification-close')) {
  //       this.removeNotification(notificationEl);
  //       return;
  //     }

  //     window.focus();
  //     this.removeNotification(notificationEl);

  //     // Dispatch custom event for navigation
  //     if (config.channel) {
  //       const event = new CustomEvent('notification-click', {
  //         detail: { channel: config.channel, sender: config.sender }
  //       });
  //       window.dispatchEvent(event);
  //     }
  //   };

  //   // Close button handler
  //   const closeBtn = notificationEl.querySelector('.notification-close') as HTMLButtonElement;
  //   if (closeBtn) {
  //     closeBtn.onclick = (e: MouseEvent) => {
  //       e.stopPropagation();
  //       this.removeNotification(notificationEl);
  //     };
  //   }

  //   this.fallbackContainer.appendChild(notificationEl);

  //   // Auto remove after 8 seconds (longer than system notifications)
  //   setTimeout(() => {
  //     if (notificationEl.parentNode) {
  //       this.removeNotification(notificationEl);
  //     }
  //   }, 8000);
  // }

  // /**
  //  * Remove notification with animation
  //  */
  // private removeNotification(element: HTMLElement) {
  //   element.style.animation = 'slideOut 0.3s cubic-bezier(0.23, 1, 0.320, 1)';
  //   setTimeout(() => {
  //     if (element.parentNode) {
  //       element.parentNode.removeChild(element);
  //     }
  //   }, 300);
  // }

  // /**
  //  * Escape HTML to prevent XSS
  //  */
  // private escapeHtml(text: string): string {
  //   const div = document.createElement('div');
  //   div.textContent = text;
  //   return div.innerHTML;
  // }

  /**
   * Check if notifications should be shown (always show notifications now)
   */
  private shouldShowNotification(): boolean {
    // Remove window active state check, always show notifications
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

    // Commented out in-browser notification fallback logic
    // if (!systemNotification) {
    //   console.log('Falling back to in-browser notification');
    //   this.showInBrowserNotification(config);
    // }
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
      fallbackAvailable: !!this.fallbackContainer
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
      // fallbackAvailable: !!this.fallbackContainer, // Commented out: no longer using in-browser notifications
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