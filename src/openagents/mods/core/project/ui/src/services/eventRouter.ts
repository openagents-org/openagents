interface EventRouter {
  initialize: (connection: any) => void;
  cleanup: () => void;
  onForumEvent: (handler: (event: any) => void) => void;
  onChatEvent: (handler: (event: any) => void) => void;
  onWikiEvent: (handler: (event: any) => void) => void;
  onDocumentEvent: (handler: (event: any) => void) => void;
  offForumEvent: (handler: (event: any) => void) => void;
  offChatEvent: (handler: (event: any) => void) => void;
  offWikiEvent: (handler: (event: any) => void) => void;
  offDocumentEvent: (handler: (event: any) => void) => void;
}

class EventRouterImpl implements EventRouter {
  private connection: any = null;
  private processedEventIds = new Set<string>();
  private forumHandlers = new Set<(event: any) => void>();
  private chatHandlers = new Set<(event: any) => void>();
  private wikiHandlers = new Set<(event: any) => void>();
  private documentHandlers = new Set<(event: any) => void>();
  private rawEventHandler: ((event: any) => void) | null = null;

  initialize(connection: any) {
    if (this.connection === connection) return;

    this.cleanup();
    this.connection = connection;

    if (!connection) return;

    this.rawEventHandler = (event: any) => {
      this.handleRawEvent(event);
    };

    connection.on("rawEvent", this.rawEventHandler);
  }

  cleanup() {
    if (this.connection && this.rawEventHandler) {
      this.connection.off("rawEvent", this.rawEventHandler);
    }

    this.connection = null;
    this.rawEventHandler = null;
    this.processedEventIds.clear();
  }

  private handleRawEvent(event: any) {
    if (event.event_id && this.processedEventIds.has(event.event_id)) {
      return;
    }

    if (event.event_id) {
      this.processedEventIds.add(event.event_id);
    }

    const eventName = event.event_name || "";

    if (eventName.startsWith("forum.")) {
      this.forumHandlers.forEach((handler) => {
        try {
          handler(event);
        } catch (error) {
          console.error("EventRouter: Error in forum event handler:", error);
        }
      });
    } else if (
      eventName.startsWith("chat.") ||
      eventName.startsWith("messaging.") ||
      eventName.startsWith("thread.") ||
      eventName.startsWith("project.")
    ) {
      this.chatHandlers.forEach((handler) => {
        try {
          handler(event);
        } catch (error) {
          console.error("EventRouter: Error in chat event handler:", error);
        }
      });
    } else if (eventName.startsWith("wiki.")) {
      this.wikiHandlers.forEach((handler) => {
        try {
          handler(event);
        } catch (error) {
          console.error("EventRouter: Error in wiki event handler:", error);
        }
      });
    } else if (eventName.startsWith("document.")) {
      this.documentHandlers.forEach((handler) => {
        try {
          handler(event);
        } catch (error) {
          console.error("EventRouter: Error in document event handler:", error);
        }
      });
    }

    if (this.processedEventIds.size > 1000) {
      const eventIds = Array.from(this.processedEventIds);
      const toRemove = eventIds.slice(0, eventIds.length - 1000);
      toRemove.forEach((id) => this.processedEventIds.delete(id));
    }
  }

  onForumEvent(handler: (event: any) => void) {
    this.forumHandlers.add(handler);
  }

  onChatEvent(handler: (event: any) => void) {
    this.chatHandlers.add(handler);
  }

  onWikiEvent(handler: (event: any) => void) {
    this.wikiHandlers.add(handler);
  }

  onDocumentEvent(handler: (event: any) => void) {
    this.documentHandlers.add(handler);
  }

  offForumEvent(handler: (event: any) => void) {
    this.forumHandlers.delete(handler);
  }

  offChatEvent(handler: (event: any) => void) {
    this.chatHandlers.delete(handler);
  }

  offWikiEvent(handler: (event: any) => void) {
    this.wikiHandlers.delete(handler);
  }

  offDocumentEvent(handler: (event: any) => void) {
    this.documentHandlers.delete(handler);
  }
}

export const eventRouter = new EventRouterImpl();

if (typeof window !== "undefined") {
  // @ts-ignore
  window.__EVENT_ROUTER__ = eventRouter;
}

