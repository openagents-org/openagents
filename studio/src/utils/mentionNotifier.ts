/**
 * Utility for handling mention notifications
 */

import { ThreadMessage } from '../services/openagentsService';

interface NotificationConfig {
  enabled: boolean;
  sound: boolean;
  desktop: boolean;
}

class MentionNotifier {
  private static readonly STORAGE_KEY = 'openagents_notification_config';
  private config: NotificationConfig;
  private currentUserAgent: string = '';

  constructor() {
    this.config = this.loadConfig();
    this.requestNotificationPermission();
  }

  /**
   * Load notification configuration from localStorage
   */
  private loadConfig(): NotificationConfig {
    try {
      const stored = localStorage.getItem(MentionNotifier.STORAGE_KEY);
      if (stored) {
        return { enabled: true, sound: true, desktop: true, ...JSON.parse(stored) };
      }
    } catch (error) {
      console.warn('Failed to load notification config:', error);
    }
    
    return {
      enabled: true,
      sound: true,
      desktop: true
    };
  }

  /**
   * Save notification configuration to localStorage
   */
  private saveConfig(): void {
    try {
      localStorage.setItem(MentionNotifier.STORAGE_KEY, JSON.stringify(this.config));
    } catch (error) {
      console.warn('Failed to save notification config:', error);
    }
  }

  /**
   * Request desktop notification permission
   */
  private async requestNotificationPermission(): Promise<void> {
    if ('Notification' in window) {
      if (Notification.permission === 'default') {
        try {
          const permission = await Notification.requestPermission();
          console.log(`🔔 Notification permission: ${permission}`);
          
          // Show a test notification if permission granted
          if (permission === 'granted') {
            setTimeout(() => {
              this.showTestNotification();
            }, 1000);
          }
        } catch (error) {
          console.warn('Failed to request notification permission:', error);
        }
      } else if (Notification.permission === 'granted') {
        console.log('🔔 Notification permission already granted');
      } else {
        console.warn('🔔 Notification permission denied');
      }
    } else {
      console.warn('🔔 Notifications not supported in this browser');
    }
  }

  /**
   * Show a test notification to confirm system integration
   */
  private showTestNotification(): void {
    try {
      const notification = new Notification('OpenAgents Studio', {
        body: 'Mention notifications are now enabled!',
        icon: '/favicon.ico',
        tag: 'test-notification',
        silent: true,
        requireInteraction: false
      });

      setTimeout(() => {
        try {
          notification.close();
        } catch (e) {
          // Notification might already be closed
        }
      }, 3000);

      notification.onclick = () => {
        notification.close();
      };
    } catch (error) {
      console.warn('Failed to show test notification:', error);
    }
  }

  /**
   * Set the current user's agent ID
   */
  setCurrentUserAgent(agentId: string): void {
    this.currentUserAgent = agentId;
  }

  /**
   * Check if a message mentions the current user
   */
  isUserMentioned(message: ThreadMessage): boolean {
    if (!this.currentUserAgent || !message.content?.text) {
      return false;
    }

    const text = message.content.text.toLowerCase();
    const userAgent = this.currentUserAgent.toLowerCase();
    
    // Check for @username mentions
    const mentionPattern = new RegExp(`@${userAgent.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
    if (mentionPattern.test(text)) {
      return true;
    }

    // Check for display name mentions if available
    // You might want to expand this based on your user display name logic
    
    return false;
  }

  /**
   * Show notification for a mention
   */
  async showMentionNotification(message: ThreadMessage, channelName?: string): Promise<void> {
    if (!this.config.enabled || !this.isUserMentioned(message)) {
      return;
    }

    const senderName = message.sender_id || 'Someone';
    const location = channelName ? `#${channelName}` : 'Direct Message';
    const text = message.content?.text || '';
    
    // Truncate long messages
    const truncatedText = text.length > 100 ? text.substring(0, 100) + '...' : text;
    
    // Play system notification sound
    if (this.config.sound) {
      this.playSystemNotificationSound();
    }

    // Show native system notification
    if (this.config.desktop && 'Notification' in window && Notification.permission === 'granted') {
      try {
        const notification = new Notification(`${senderName} mentioned you in ${location}`, {
          body: truncatedText,
          icon: '/favicon.ico',
          tag: `mention-${message.message_id}`, // Prevents duplicate notifications
          requireInteraction: false,
          silent: false, // Let the system handle the sound (macOS will use system sound)
          badge: '/favicon.ico',
          // Keep it simple for better cross-platform compatibility
          dir: 'auto',
          lang: 'en'
        });

        // Auto-close after 8 seconds (longer for system notifications)
        setTimeout(() => {
          try {
            notification.close();
          } catch (e) {
            // Notification might already be closed by user
          }
        }, 8000);

        // Handle notification interactions
        notification.onclick = () => {
          window.focus();
          // Bring window to front on macOS/other systems
          if (window.parent && window.parent !== window) {
            window.parent.focus();
          }
          notification.close();
        };

        // Handle action buttons (if supported)
        notification.onshow = () => {
          console.log('🔔 System notification shown');
        };

        notification.onclose = () => {
          console.log('🔔 System notification closed');
        };

        notification.onerror = (error) => {
          console.warn('🔔 System notification error:', error);
        };

      } catch (error) {
        console.warn('Failed to show system notification:', error);
        // Fallback to simpler notification
        this.showFallbackNotification(senderName, location, truncatedText, message.message_id);
      }
    } else {
      // Show fallback notification if permission not granted
      this.showFallbackNotification(senderName, location, truncatedText, message.message_id);
    }

    // Log mention for debugging
    console.log(`🔔 Mention notification: ${senderName} mentioned you in ${location}`);
  }

  /**
   * Play system notification sound
   */
  private playSystemNotificationSound(): void {
    try {
      // Use system notification sound - let the OS handle it
      // This is more native and respects user's system preferences
      
      // Fallback: create a subtle notification sound if needed
      if ('speechSynthesis' in window) {
        // Use a very short, quiet beep as fallback
        const utterance = new SpeechSynthesisUtterance('');
        utterance.volume = 0.1;
        utterance.rate = 10;
        utterance.pitch = 2;
        speechSynthesis.speak(utterance);
      } else {
        // Last resort: brief Web Audio sound
        const AudioContextClass = (window as any).AudioContext || (window as any).webkitAudioContext;
        if (AudioContextClass) {
          const audioContext = new AudioContextClass();
          const oscillator = audioContext.createOscillator();
          const gainNode = audioContext.createGain();
          
          oscillator.connect(gainNode);
          gainNode.connect(audioContext.destination);
          
          oscillator.frequency.setValueAtTime(800, audioContext.currentTime);
          gainNode.gain.setValueAtTime(0.05, audioContext.currentTime); // Much quieter
          gainNode.gain.exponentialRampToValueAtTime(0.001, audioContext.currentTime + 0.1);
          
          oscillator.start(audioContext.currentTime);
          oscillator.stop(audioContext.currentTime + 0.1);
        }
      }
    } catch (error) {
      console.warn('Failed to play system notification sound:', error);
    }
  }

  /**
   * Show fallback notification when system notifications aren't available
   */
  private showFallbackNotification(senderName: string, location: string, text: string, messageId: string): void {
    // Show a subtle browser-based notification
    console.log(`🔔 [FALLBACK] ${senderName} mentioned you in ${location}: ${text}`);
    
    // Could also show a temporary overlay in the UI
    // For now, just log to console as fallback
  }

  /**
   * Update notification configuration
   */
  updateConfig(newConfig: Partial<NotificationConfig>): void {
    this.config = { ...this.config, ...newConfig };
    this.saveConfig();
  }

  /**
   * Get current notification configuration
   */
  getConfig(): NotificationConfig {
    return { ...this.config };
  }

  /**
   * Check if desktop notifications are supported and permitted
   */
  isDesktopNotificationAvailable(): boolean {
    return 'Notification' in window && Notification.permission === 'granted';
  }

  /**
   * Get notification permission status
   */
  getPermissionStatus(): NotificationPermission | 'unsupported' {
    if ('Notification' in window) {
      return Notification.permission;
    }
    return 'unsupported';
  }
}

// Export singleton instance
export const mentionNotifier = new MentionNotifier();

export default MentionNotifier;
