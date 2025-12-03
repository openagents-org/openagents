import { create } from "zustand";

// ============ Types ============

export interface PlaygroundSession {
  session_id: string;
  name: string;
  description: string;
  owner_id: string;
  status: "created" | "active" | "paused" | "completed" | "archived";
  channel_id: string;
  board_id: string | null;
  allowed_agent_groups: string[];
  participants: string[];
  artifacts: Record<string, string>;
  created_at: number;
  updated_at: number;
  started_at: number | null;
  completed_at: number | null;
  goal: string | null;
  context: string | null;
  summary: string | null;
}

export interface KanbanColumn {
  column_id: string;
  name: string;
  position: number;
  wip_limit: number | null;
}

export interface KanbanCard {
  card_id: string;
  board_id: string;
  column_id: string;
  title: string;
  description: string;
  assignee_id: string | null;
  labels: string[];
  priority: "low" | "medium" | "high" | "urgent";
  position: number;
  created_by: string;
  created_at: number;
  updated_at: number;
  metadata: Record<string, unknown>;
}

export interface KanbanBoard {
  board_id: string;
  name: string;
  description: string;
  columns: KanbanColumn[];
  owner_id: string;
  allowed_agent_groups: string[];
  created_at: number;
  updated_at: number;
  project_id: string | null;
}

interface PlaygroundState {
  // Connection
  connection: unknown | null;
  agentId: string | null;

  // Sessions
  sessions: PlaygroundSession[];
  sessionsLoading: boolean;
  sessionsError: string | null;
  currentSession: PlaygroundSession | null;

  // Kanban Board
  currentBoard: KanbanBoard | null;
  cards: KanbanCard[];
  boardLoading: boolean;
  boardError: string | null;

  // Artifacts
  artifactsLoading: boolean;

  // UI State
  selectedCardId: string | null;
  isCreateSessionModalOpen: boolean;
  isCreateCardModalOpen: boolean;

  // Actions - Connection
  setConnection: (connection: unknown | null) => void;
  setAgentId: (agentId: string) => void;

  // Actions - Sessions
  loadSessions: (status?: string) => Promise<void>;
  createSession: (data: {
    name: string;
    description?: string;
    goal?: string;
    context?: string;
  }) => Promise<PlaygroundSession | null>;
  loadSession: (sessionId: string) => Promise<void>;
  startSession: (sessionId: string) => Promise<boolean>;
  joinSession: (sessionId: string) => Promise<boolean>;
  leaveSession: (sessionId: string) => Promise<boolean>;
  completeSession: (sessionId: string, summary?: string) => Promise<boolean>;

  // Actions - Kanban
  loadBoard: (boardId: string) => Promise<void>;
  createCard: (data: {
    title: string;
    description?: string;
    column_id?: string;
    assignee_id?: string;
    labels?: string[];
    priority?: string;
  }) => Promise<KanbanCard | null>;
  updateCard: (
    cardId: string,
    data: Partial<KanbanCard>
  ) => Promise<boolean>;
  moveCard: (cardId: string, columnId: string, position?: number) => Promise<boolean>;
  deleteCard: (cardId: string) => Promise<boolean>;

  // Actions - Artifacts
  setArtifact: (key: string, value: string) => Promise<boolean>;
  getArtifact: (key: string) => Promise<string | null>;
  deleteArtifact: (key: string) => Promise<boolean>;

  // Actions - UI
  setSelectedCardId: (cardId: string | null) => void;
  setCreateSessionModalOpen: (open: boolean) => void;
  setCreateCardModalOpen: (open: boolean) => void;

  // Helpers
  getCardsByColumn: (columnId: string) => KanbanCard[];
  reset: () => void;
}

export const usePlaygroundStore = create<PlaygroundState>((set, get) => ({
  // Initial State
  connection: null,
  agentId: null,
  sessions: [],
  sessionsLoading: false,
  sessionsError: null,
  currentSession: null,
  currentBoard: null,
  cards: [],
  boardLoading: false,
  boardError: null,
  artifactsLoading: false,
  selectedCardId: null,
  isCreateSessionModalOpen: false,
  isCreateCardModalOpen: false,

  // Connection Actions
  setConnection: (connection) => set({ connection }),
  setAgentId: (agentId) => set({ agentId }),

  // Session Actions
  loadSessions: async (status?: string) => {
    const { connection } = get();
    if (!connection) return;

    set({ sessionsLoading: true, sessionsError: null });

    try {
      const payload: Record<string, unknown> = {};
      if (status) payload.status = status;

      const response = await (connection as any).sendEvent({
        event_name: "playground.list",
        destination_id: "mod:openagents.mods.workspace.playground",
        payload,
      });

      if (response.success && response.data) {
        set({
          sessions: response.data.sessions || [],
          sessionsLoading: false,
        });
      } else {
        set({
          sessionsError: response.message || "Failed to load sessions",
          sessionsLoading: false,
        });
      }
    } catch (error) {
      console.error("Failed to load sessions:", error);
      set({
        sessionsError: "Failed to load sessions",
        sessionsLoading: false,
      });
    }
  },

  createSession: async (data) => {
    const { connection } = get();
    if (!connection) return null;

    try {
      const response = await (connection as any).sendEvent({
        event_name: "playground.create",
        destination_id: "mod:openagents.mods.workspace.playground",
        payload: {
          name: data.name,
          description: data.description || "",
          goal: data.goal,
          context: data.context,
          create_board: true,
        },
      });

      if (response.success && response.data?.session) {
        const session = response.data.session as PlaygroundSession;
        set((state) => ({
          sessions: [session, ...state.sessions],
          currentSession: session,
        }));
        return session;
      }
      return null;
    } catch (error) {
      console.error("Failed to create session:", error);
      return null;
    }
  },

  loadSession: async (sessionId: string) => {
    const { connection } = get();
    if (!connection) return;

    try {
      const response = await (connection as any).sendEvent({
        event_name: "playground.get",
        destination_id: "mod:openagents.mods.workspace.playground",
        payload: { session_id: sessionId },
      });

      if (response.success && response.data?.session) {
        const session = response.data.session as PlaygroundSession;
        set({ currentSession: session });

        // Load the board if it exists
        if (session.board_id) {
          get().loadBoard(session.board_id);
        }
      }
    } catch (error) {
      console.error("Failed to load session:", error);
    }
  },

  startSession: async (sessionId: string) => {
    const { connection } = get();
    if (!connection) return false;

    try {
      const response = await (connection as any).sendEvent({
        event_name: "playground.start",
        destination_id: "mod:openagents.mods.workspace.playground",
        payload: { session_id: sessionId },
      });

      if (response.success && response.data?.session) {
        set({ currentSession: response.data.session });
        return true;
      }
      return false;
    } catch (error) {
      console.error("Failed to start session:", error);
      return false;
    }
  },

  joinSession: async (sessionId: string) => {
    const { connection } = get();
    if (!connection) return false;

    try {
      const response = await (connection as any).sendEvent({
        event_name: "playground.join",
        destination_id: "mod:openagents.mods.workspace.playground",
        payload: { session_id: sessionId },
      });

      if (response.success && response.data?.session) {
        set({ currentSession: response.data.session });
        return true;
      }
      return false;
    } catch (error) {
      console.error("Failed to join session:", error);
      return false;
    }
  },

  leaveSession: async (sessionId: string) => {
    const { connection } = get();
    if (!connection) return false;

    try {
      const response = await (connection as any).sendEvent({
        event_name: "playground.leave",
        destination_id: "mod:openagents.mods.workspace.playground",
        payload: { session_id: sessionId },
      });

      if (response.success) {
        set({ currentSession: null, currentBoard: null, cards: [] });
        return true;
      }
      return false;
    } catch (error) {
      console.error("Failed to leave session:", error);
      return false;
    }
  },

  completeSession: async (sessionId: string, summary?: string) => {
    const { connection } = get();
    if (!connection) return false;

    try {
      const response = await (connection as any).sendEvent({
        event_name: "playground.complete",
        destination_id: "mod:openagents.mods.workspace.playground",
        payload: { session_id: sessionId, summary },
      });

      if (response.success && response.data?.session) {
        set({ currentSession: response.data.session });
        return true;
      }
      return false;
    } catch (error) {
      console.error("Failed to complete session:", error);
      return false;
    }
  },

  // Kanban Actions
  loadBoard: async (boardId: string) => {
    const { connection } = get();
    if (!connection) return;

    set({ boardLoading: true, boardError: null });

    try {
      const response = await (connection as any).sendEvent({
        event_name: "kanban.board.get",
        destination_id: "mod:openagents.mods.coordination.kanban",
        payload: { board_id: boardId },
      });

      if (response.success && response.data) {
        set({
          currentBoard: response.data.board,
          cards: response.data.cards || [],
          boardLoading: false,
        });
      } else {
        set({
          boardError: response.message || "Failed to load board",
          boardLoading: false,
        });
      }
    } catch (error) {
      console.error("Failed to load board:", error);
      set({
        boardError: "Failed to load board",
        boardLoading: false,
      });
    }
  },

  createCard: async (data) => {
    const { connection, currentBoard } = get();
    if (!connection || !currentBoard) return null;

    try {
      const response = await (connection as any).sendEvent({
        event_name: "kanban.card.create",
        destination_id: "mod:openagents.mods.coordination.kanban",
        payload: {
          board_id: currentBoard.board_id,
          title: data.title,
          description: data.description || "",
          column_id: data.column_id || currentBoard.columns[0]?.column_id,
          assignee_id: data.assignee_id,
          labels: data.labels || [],
          priority: data.priority || "medium",
        },
      });

      if (response.success && response.data?.card) {
        const card = response.data.card as KanbanCard;
        set((state) => ({
          cards: [...state.cards, card],
        }));
        return card;
      }
      return null;
    } catch (error) {
      console.error("Failed to create card:", error);
      return null;
    }
  },

  updateCard: async (cardId: string, data: Partial<KanbanCard>) => {
    const { connection } = get();
    if (!connection) return false;

    try {
      const response = await (connection as any).sendEvent({
        event_name: "kanban.card.update",
        destination_id: "mod:openagents.mods.coordination.kanban",
        payload: {
          card_id: cardId,
          ...data,
        },
      });

      if (response.success && response.data?.card) {
        set((state) => ({
          cards: state.cards.map((c) =>
            c.card_id === cardId ? response.data.card : c
          ),
        }));
        return true;
      }
      return false;
    } catch (error) {
      console.error("Failed to update card:", error);
      return false;
    }
  },

  moveCard: async (cardId: string, columnId: string, position?: number) => {
    const { connection, cards } = get();
    if (!connection) return false;

    // Optimistic update
    const cardIndex = cards.findIndex((c) => c.card_id === cardId);
    if (cardIndex === -1) return false;

    const oldCard = cards[cardIndex];
    const newCards = [...cards];
    newCards[cardIndex] = { ...oldCard, column_id: columnId };
    set({ cards: newCards });

    try {
      const payload: Record<string, unknown> = {
        card_id: cardId,
        column_id: columnId,
      };
      if (position !== undefined) payload.position = position;

      const response = await (connection as any).sendEvent({
        event_name: "kanban.card.move",
        destination_id: "mod:openagents.mods.coordination.kanban",
        payload,
      });

      if (response.success && response.data?.card) {
        set((state) => ({
          cards: state.cards.map((c) =>
            c.card_id === cardId ? response.data.card : c
          ),
        }));
        return true;
      } else {
        // Revert on failure
        set({ cards });
        return false;
      }
    } catch (error) {
      console.error("Failed to move card:", error);
      set({ cards }); // Revert
      return false;
    }
  },

  deleteCard: async (cardId: string) => {
    const { connection } = get();
    if (!connection) return false;

    try {
      const response = await (connection as any).sendEvent({
        event_name: "kanban.card.delete",
        destination_id: "mod:openagents.mods.coordination.kanban",
        payload: { card_id: cardId },
      });

      if (response.success) {
        set((state) => ({
          cards: state.cards.filter((c) => c.card_id !== cardId),
          selectedCardId:
            state.selectedCardId === cardId ? null : state.selectedCardId,
        }));
        return true;
      }
      return false;
    } catch (error) {
      console.error("Failed to delete card:", error);
      return false;
    }
  },

  // Artifact Actions
  setArtifact: async (key: string, value: string) => {
    const { connection, currentSession } = get();
    if (!connection || !currentSession) return false;

    try {
      const response = await (connection as any).sendEvent({
        event_name: "playground.artifact.set",
        destination_id: "mod:openagents.mods.workspace.playground",
        payload: {
          session_id: currentSession.session_id,
          key,
          value,
        },
      });

      if (response.success) {
        set((state) => ({
          currentSession: state.currentSession
            ? {
                ...state.currentSession,
                artifacts: { ...state.currentSession.artifacts, [key]: value },
              }
            : null,
        }));
        return true;
      }
      return false;
    } catch (error) {
      console.error("Failed to set artifact:", error);
      return false;
    }
  },

  getArtifact: async (key: string) => {
    const { connection, currentSession } = get();
    if (!connection || !currentSession) return null;

    try {
      const response = await (connection as any).sendEvent({
        event_name: "playground.artifact.get",
        destination_id: "mod:openagents.mods.workspace.playground",
        payload: {
          session_id: currentSession.session_id,
          key,
        },
      });

      if (response.success) {
        return response.data?.value || null;
      }
      return null;
    } catch (error) {
      console.error("Failed to get artifact:", error);
      return null;
    }
  },

  deleteArtifact: async (key: string) => {
    const { connection, currentSession } = get();
    if (!connection || !currentSession) return false;

    try {
      const response = await (connection as any).sendEvent({
        event_name: "playground.artifact.delete",
        destination_id: "mod:openagents.mods.workspace.playground",
        payload: {
          session_id: currentSession.session_id,
          key,
        },
      });

      if (response.success) {
        set((state) => {
          if (!state.currentSession) return state;
          const newArtifacts = { ...state.currentSession.artifacts };
          delete newArtifacts[key];
          return {
            currentSession: { ...state.currentSession, artifacts: newArtifacts },
          };
        });
        return true;
      }
      return false;
    } catch (error) {
      console.error("Failed to delete artifact:", error);
      return false;
    }
  },

  // UI Actions
  setSelectedCardId: (cardId) => set({ selectedCardId: cardId }),
  setCreateSessionModalOpen: (open) => set({ isCreateSessionModalOpen: open }),
  setCreateCardModalOpen: (open) => set({ isCreateCardModalOpen: open }),

  // Helpers
  getCardsByColumn: (columnId: string) => {
    const { cards } = get();
    return cards
      .filter((c) => c.column_id === columnId)
      .sort((a, b) => a.position - b.position);
  },

  reset: () =>
    set({
      sessions: [],
      currentSession: null,
      currentBoard: null,
      cards: [],
      selectedCardId: null,
    }),
}));
