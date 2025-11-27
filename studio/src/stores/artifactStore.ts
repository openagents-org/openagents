import { create } from "zustand";

// Types
export interface Artifact {
  artifact_id: string;
  name: string;
  content: string;
  mime_type: string;
  file_size?: number;
  allowed_agent_groups?: string[];
  created_by?: string;
  created_at?: number;
  updated_at?: number;
}


export interface CreateArtifactData {
  name: string;
  content: string;
  mime_type: string;
  allowed_agent_groups?: string[];
}

interface ArtifactState {
  // Artifact list
  artifacts: Artifact[];
  artifactsLoading: boolean;
  artifactsError: string | null;

  // Pagination
  currentPage: number;
  itemsPerPage: number;
  totalItems: number;

  // Current artifact details
  selectedArtifact: Artifact | null;
  artifactLoading: boolean;
  artifactError: string | null;

  // Connection service
  connection: any | null;

  // Permission groups
  groupsData: Record<string, string[]> | null;
  agentId: string | null;

  // Actions
  setConnection: (connection: any | null) => void;
  setGroupsData: (groups: Record<string, string[]>) => void;
  setAgentId: (agentId: string) => void;
  loadArtifacts: (mimeType?: string) => Promise<void>;
  loadArtifact: (artifactId: string) => Promise<void>;
  createArtifact: (data: CreateArtifactData) => Promise<boolean>;
  updateArtifact: (artifactId: string, content: string) => Promise<boolean>;
  deleteArtifact: (artifactId: string) => Promise<boolean>;

  // Pagination actions
  setCurrentPage: (page: number) => void;
  getPaginatedArtifacts: () => Artifact[];
  getTotalPages: () => number;

  // Reset
  resetSelectedArtifact: () => void;
}

export const useArtifactStore = create<ArtifactState>((set, get) => ({
  // Initial state
  artifacts: [],
  artifactsLoading: false,
  artifactsError: null,
  currentPage: 1,
  itemsPerPage: 12,
  totalItems: 0,
  selectedArtifact: null,
  artifactLoading: false,
  artifactError: null,
  connection: null,
  groupsData: null,
  agentId: null,

  // Actions
  setConnection: (connection) => set({ connection }),
  setGroupsData: (groups) => set({ groupsData: groups }),
  setAgentId: (agentId) => set({ agentId }),

  loadArtifacts: async (mimeType?: string) => {
    const { connection } = get();
    if (!connection) {
      console.warn("ArtifactStore: No connection available for loadArtifacts");
      set({ artifactsError: "No connection available" });
      return;
    }

    console.log("ArtifactStore: Loading artifacts...", { mimeType });
    set({ artifactsLoading: true, artifactsError: null });

    try {
      const payload: any = {};
      if (mimeType) {
        payload.mime_type = mimeType;
      }

      const response = await connection.sendEvent({
        event_name: "shared_artifact.list",
        destination_id: "mod:openagents.mods.workspace.shared_artifact",
        payload,
      });

      if (response.success && response.data) {
        console.log(
          "ArtifactStore: API success, loaded artifacts:",
          response.data.artifacts?.length || 0
        );
        const artifacts = response.data.artifacts || [];
        set({
          artifacts,
          totalItems: artifacts.length,
          artifactsLoading: false,
          currentPage: 1, // Reset to first page when loading new data
        });
      } else {
        console.warn(
          "ArtifactStore: API failed to load artifacts. Response:",
          response
        );
        set({
          artifacts: [],
          artifactsLoading: false,
          artifactsError: response.message || "Failed to load artifacts",
        });
      }
    } catch (error) {
      console.error("ArtifactStore: Failed to load artifacts:", error);
      set({
        artifactsError: "Failed to load artifacts",
        artifactsLoading: false,
      });
    }
  },

  loadArtifact: async (artifactId: string) => {
    const { connection } = get();
    if (!connection) {
      console.warn("ArtifactStore: No connection available for loadArtifact");
      set({ artifactError: "No connection available" });
      return;
    }

    console.log("ArtifactStore: Loading artifact:", artifactId);
    set({ artifactLoading: true, artifactError: null });

    try {
      const response = await connection.sendEvent({
        event_name: "shared_artifact.get",
        destination_id: "mod:openagents.mods.workspace.shared_artifact",
        payload: {
          artifact_id: artifactId,
        },
      });

      if (response.success && response.data) {
        console.log("ArtifactStore: API success, loaded artifact:", response.data);
        set({
          selectedArtifact: response.data,
          artifactLoading: false,
        });
      } else {
        console.warn(
          "ArtifactStore: API failed to load artifact. Response:",
          response
        );
        set({
          selectedArtifact: null,
          artifactLoading: false,
          artifactError: response.message || "Failed to load artifact",
        });
      }
    } catch (error) {
      console.error("ArtifactStore: Failed to load artifact:", error);
      set({
        artifactError: "Failed to load artifact",
        artifactLoading: false,
      });
    }
  },

  createArtifact: async (data: CreateArtifactData) => {
    const { connection } = get();
    if (!connection) return false;

    try {
      const payload: any = {
        name: data.name.trim(),
        content: data.content,
        mime_type: data.mime_type,
      };

      if (data.allowed_agent_groups && data.allowed_agent_groups.length > 0) {
        payload.allowed_agent_groups = data.allowed_agent_groups;
      }

      const response = await connection.sendEvent({
        event_name: "shared_artifact.create",
        destination_id: "mod:openagents.mods.workspace.shared_artifact",
        payload,
      });

      if (response.success && response.data) {
        // Construct new artifact object and add directly to list
        const newArtifact: Artifact = {
          artifact_id: response.data.artifact_id,
          name: data.name.trim(),
          content: data.content,
          mime_type: data.mime_type,
          file_size: response.data.file_size,
          allowed_agent_groups: data.allowed_agent_groups,
          created_by: response.data.created_by || connection.getAgentId() || "unknown",
          created_at: response.data.created_at || Date.now() / 1000,
          updated_at: response.data.updated_at || Date.now() / 1000,
        };

        console.log("ArtifactStore: Creating artifact with data:", newArtifact);

        // Add directly to top of list, no need to reload
        set((state) => ({
          artifacts: [newArtifact, ...state.artifacts],
          totalItems: state.totalItems + 1,
          currentPage: 1, // Go to first page to show the new artifact
        }));
        return true;
      }
      return false;
    } catch (error) {
      console.error("Failed to create artifact:", error);
      return false;
    }
  },

  updateArtifact: async (artifactId: string, content: string) => {
    const { connection } = get();
    if (!connection) return false;

    try {
      const response = await connection.sendEvent({
        event_name: "shared_artifact.update",
        destination_id: "mod:openagents.mods.workspace.shared_artifact",
        payload: {
          artifact_id: artifactId,
          content: content,
        },
      });

      if (response.success) {
        const now = Date.now() / 1000;
        const fileSize = new Blob([content]).size;
        
        // Update in list
        set((state) => ({
          artifacts: state.artifacts.map((artifact) =>
            artifact.artifact_id === artifactId
              ? { ...artifact, content, file_size: fileSize, updated_at: now }
              : artifact
          ),
          selectedArtifact:
            state.selectedArtifact?.artifact_id === artifactId
              ? { ...state.selectedArtifact, content, file_size: fileSize, updated_at: now }
              : state.selectedArtifact,
        }));
        return true;
      }
      return false;
    } catch (error) {
      console.error("Failed to update artifact:", error);
      return false;
    }
  },

  deleteArtifact: async (artifactId: string) => {
    const { connection } = get();
    if (!connection) return false;

    try {
      const response = await connection.sendEvent({
        event_name: "shared_artifact.delete",
        destination_id: "mod:openagents.mods.workspace.shared_artifact",
        payload: {
          artifact_id: artifactId,
        },
      });

      if (response.success) {
        // Remove from list
        set((state) => {
          const newArtifacts = state.artifacts.filter(
            (artifact) => artifact.artifact_id !== artifactId
          );
          const newTotalItems = newArtifacts.length;
          const totalPages = Math.ceil(newTotalItems / state.itemsPerPage);
          const newCurrentPage = state.currentPage > totalPages ? Math.max(1, totalPages) : state.currentPage;
          
          return {
            artifacts: newArtifacts,
            totalItems: newTotalItems,
            currentPage: newCurrentPage,
            selectedArtifact:
              state.selectedArtifact?.artifact_id === artifactId
                ? null
                : state.selectedArtifact,
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

  // Pagination actions
  setCurrentPage: (page: number) => {
    const { totalItems, itemsPerPage } = get();
    const totalPages = Math.ceil(totalItems / itemsPerPage);
    const validPage = Math.max(1, Math.min(page, totalPages));
    set({ currentPage: validPage });
  },

  getPaginatedArtifacts: () => {
    const { artifacts, currentPage, itemsPerPage } = get();
    const startIndex = (currentPage - 1) * itemsPerPage;
    const endIndex = startIndex + itemsPerPage;
    return artifacts.slice(startIndex, endIndex);
  },

  getTotalPages: () => {
    const { totalItems, itemsPerPage } = get();
    return Math.ceil(totalItems / itemsPerPage);
  },

  resetSelectedArtifact: () => {
    set({ selectedArtifact: null, artifactError: null });
  },
}));
