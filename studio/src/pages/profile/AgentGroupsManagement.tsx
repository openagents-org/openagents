import React, { useState, useEffect, useCallback } from 'react';
import { useOpenAgents } from '@/context/OpenAgentsProvider';
import { useAuthStore } from '@/stores/authStore';
import { useConfirm } from '@/context/ConfirmContext';

interface AgentGroupInfo {
  name: string;
  description: string;
  has_password: boolean;
  member_count: number;
  members: string[];
  permissions: string[];
  metadata: Record<string, any>;
  is_default: boolean;
}

interface NetworkGroupSettings {
  agent_groups: Record<string, AgentGroupInfo>;
  default_agent_group: string;
  requires_password: boolean;
}

const AgentGroupsManagement: React.FC = () => {
  const { connector } = useOpenAgents();
  const { agentName } = useAuthStore();
  const { confirm } = useConfirm();
  
  const [groupsData, setGroupsData] = useState<NetworkGroupSettings | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [selectedGroup, setSelectedGroup] = useState<string | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [editingGroup, setEditingGroup] = useState<AgentGroupInfo | null>(null);
  
  // Network settings
  const [defaultGroup, setDefaultGroup] = useState<string>('');
  const [requiresPassword, setRequiresPassword] = useState<boolean>(false);
  const [savingSettings, setSavingSettings] = useState<boolean>(false);

  // Form state for create/edit
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    password: '',
    clearPassword: false,
    permissions: '',
    metadata: '',
  });

  // Fetch groups data from health check
  const fetchGroupsData = useCallback(async () => {
    if (!connector) {
      setError('Not connected to network');
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);

      const healthData = await connector.getNetworkHealth();
      
      if (healthData && healthData.group_config) {
        // Build agent_groups info from group_config
        const agentGroups: Record<string, AgentGroupInfo> = {};
        const groups = healthData.groups || {};
        
        for (const groupConfig of healthData.group_config) {
          const groupName = groupConfig.name;
          const members = groups[groupName] || [];
          
          agentGroups[groupName] = {
            name: groupName,
            description: groupConfig.description || '',
            has_password: groupConfig.has_password || false,
            member_count: members.length,
            members: members,
            permissions: groupConfig.metadata?.permissions || [],
            metadata: groupConfig.metadata || {},
            is_default: groupName === healthData.default_agent_group,
          };
        }

        setGroupsData({
          agent_groups: agentGroups,
          default_agent_group: healthData.default_agent_group || 'guest',
          requires_password: healthData.requires_password || false,
        });
        
        setDefaultGroup(healthData.default_agent_group || 'guest');
        setRequiresPassword(healthData.requires_password || false);
      } else {
        setGroupsData({
          agent_groups: {},
          default_agent_group: 'guest',
          requires_password: false,
        });
      }
    } catch (err) {
      console.error('Failed to fetch groups data:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch groups data');
    } finally {
      setLoading(false);
    }
  }, [connector]);

  useEffect(() => {
    fetchGroupsData();
  }, [fetchGroupsData]);

  // Update agent groups via system event
  const updateAgentGroups = async (action: string, payload: any) => {
    if (!connector || !agentName) {
      setError('Not connected to network');
      return { success: false };
    }

    try {
      const response = await connector.sendEvent({
        event_name: 'system.update_agent_groups',
        source_id: agentName,
        payload: {
          agent_id: agentName,
          ...payload,
        },
      });

      if (response.success) {
        // Update local state from response
        if (response.data) {
          setGroupsData({
            agent_groups: response.data.agent_groups || {},
            default_agent_group: response.data.default_agent_group || 'guest',
            requires_password: response.data.requires_password || false,
          });
          setDefaultGroup(response.data.default_agent_group || 'guest');
          setRequiresPassword(response.data.requires_password || false);
        } else {
          // Refresh from health check
          await fetchGroupsData();
        }
        return { success: true, message: response.message };
      } else {
        return { success: false, message: response.message || 'Operation failed' };
      }
    } catch (err) {
      console.error('Failed to update agent groups:', err);
      return { success: false, message: err instanceof Error ? err.message : 'Operation failed' };
    }
  };

  // Handle create group
  const handleCreateGroup = async () => {
    if (!formData.name.trim()) {
      setError('Group name is required');
      return;
    }

    // Validate group name
    if (!/^[a-zA-Z0-9_]+$/.test(formData.name)) {
      setError('Group name must contain only alphanumeric characters and underscores');
      return;
    }

    if (formData.name.length > 64) {
      setError('Group name must be 64 characters or less');
      return;
    }

    if (formData.description.length > 512) {
      setError('Description must be 512 characters or less');
      return;
    }

    if (formData.password && formData.password.length < 4) {
      setError('Password must be at least 4 characters');
      return;
    }

    setError(null);
    setSuccess(null);

    const permissions = formData.permissions
      .split(',')
      .map(p => p.trim())
      .filter(p => p.length > 0);

    const result = await updateAgentGroups('create', {
      action: 'create',
      group_name: formData.name.trim(),
      group_config: {
        description: formData.description.trim(),
        password: formData.password || undefined,
        permissions: permissions,
      },
    });

    if (result.success) {
      setSuccess('Group created successfully');
      setShowCreateModal(false);
      setFormData({
        name: '',
        description: '',
        password: '',
        clearPassword: false,
        permissions: '',
        metadata: '',
      });
    } else {
      setError(result.message || 'Failed to create group');
    }
  };

  // Handle update group
  const handleUpdateGroup = async () => {
    if (!editingGroup) return;

    if (formData.description.length > 512) {
      setError('Description must be 512 characters or less');
      return;
    }

    if (formData.password && formData.password.length < 4) {
      setError('Password must be at least 4 characters');
      return;
    }

    setError(null);
    setSuccess(null);

    const permissions = formData.permissions
      .split(',')
      .map(p => p.trim())
      .filter(p => p.length > 0);

    const groupConfig: any = {
      description: formData.description.trim(),
      permissions: permissions,
    };

    if (formData.clearPassword) {
      groupConfig.clear_password = true;
    } else if (formData.password) {
      groupConfig.password = formData.password;
    }

    const result = await updateAgentGroups('update', {
      action: 'update',
      group_name: editingGroup.name,
      group_config: groupConfig,
    });

    if (result.success) {
      setSuccess('Group updated successfully');
      setShowEditModal(false);
      setEditingGroup(null);
      setFormData({
        name: '',
        description: '',
        password: '',
        clearPassword: false,
        permissions: '',
        metadata: '',
      });
    } else {
      setError(result.message || 'Failed to update group');
    }
  };

  // Handle delete group
  const handleDeleteGroup = async (groupName: string) => {
    const confirmed = await confirm(
      'Delete Group',
      `Are you sure you want to delete the group "${groupName}"? This action cannot be undone.`
    );

    if (!confirmed) return;

    setError(null);
    setSuccess(null);

    const result = await updateAgentGroups('delete', {
      action: 'delete',
      group_name: groupName,
    });

    if (result.success) {
      setSuccess('Group deleted successfully');
      if (selectedGroup === groupName) {
        setSelectedGroup(null);
      }
    } else {
      setError(result.message || 'Failed to delete group');
    }
  };

  // Handle save network settings
  const handleSaveNetworkSettings = async () => {
    setSavingSettings(true);
    setError(null);
    setSuccess(null);

    try {
      // Update default group if changed
      if (defaultGroup !== groupsData?.default_agent_group) {
        const result = await updateAgentGroups('set_default', {
          action: 'set_default',
          group_name: defaultGroup,
        });
        if (!result.success) {
          setError(result.message || 'Failed to update default group');
          setSavingSettings(false);
          return;
        }
      }

      // Update requires_password if changed
      if (requiresPassword !== groupsData?.requires_password) {
        const result = await updateAgentGroups('set_requires_password', {
          action: 'set_requires_password',
          requires_password: requiresPassword,
        });
        if (!result.success) {
          setError(result.message || 'Failed to update password requirement');
          setSavingSettings(false);
          return;
        }
      }

      setSuccess('Network settings saved successfully');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save settings');
    } finally {
      setSavingSettings(false);
    }
  };

  // Open edit modal
  const openEditModal = (group: AgentGroupInfo) => {
    setEditingGroup(group);
    setFormData({
      name: group.name,
      description: group.description,
      password: '',
      clearPassword: false,
      permissions: group.permissions.join(', '),
      metadata: JSON.stringify(group.metadata, null, 2),
    });
    setShowEditModal(true);
  };

  // Open create modal
  const openCreateModal = () => {
    setFormData({
      name: '',
      description: '',
      password: '',
      clearPassword: false,
      permissions: '',
      metadata: '',
    });
    setShowCreateModal(true);
  };

  if (loading) {
    return (
      <div className="p-6 dark:bg-gray-900 h-full">
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
          <span className="ml-3 text-gray-600 dark:text-gray-400">
            Loading agent groups...
          </span>
        </div>
      </div>
    );
  }

  const groups = groupsData ? Object.values(groupsData.agent_groups) : [];

  return (
    <div className="p-6 dark:bg-gray-900 h-full min-h-screen overflow-y-auto">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-2">
          Agent Groups Management
        </h1>
        <p className="text-gray-600 dark:text-gray-400">
          Manage agent groups and their permissions
        </p>
      </div>

      {/* Error/Success Messages */}
      {error && (
        <div className="mb-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
          <div className="flex items-center">
            <svg className="h-5 w-5 text-red-400 mr-2" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
            </svg>
            <span className="text-sm text-red-800 dark:text-red-200">{error}</span>
          </div>
        </div>
      )}

      {success && (
        <div className="mb-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-4">
          <div className="flex items-center">
            <svg className="h-5 w-5 text-green-400 mr-2" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
            </svg>
            <span className="text-sm text-green-800 dark:text-green-200">{success}</span>
          </div>
        </div>
      )}

      {/* Network Settings */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6 mb-6">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
          Network Settings
        </h2>
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Default Group
              </label>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Default group for agents without valid credentials
              </p>
            </div>
            <select
              value={defaultGroup}
              onChange={(e) => setDefaultGroup(e.target.value)}
              className="px-4 py-2 rounded-lg border bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600 text-gray-900 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {groups.map((group) => (
                <option key={group.name} value={group.name}>
                  {group.name}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-center justify-between">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Require Password
              </label>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Require password authentication for all agents
              </p>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={requiresPassword}
                onChange={(e) => setRequiresPassword(e.target.checked)}
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 dark:peer-focus:ring-blue-800 rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-blue-600"></div>
            </label>
          </div>
          <div className="flex justify-end">
            <button
              onClick={handleSaveNetworkSettings}
              disabled={savingSettings}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {savingSettings ? 'Saving...' : 'Save Settings'}
            </button>
          </div>
        </div>
      </div>

      {/* Agent Groups List */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
            Agent Groups
          </h2>
          <button
            onClick={openCreateModal}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition-colors"
          >
            + Create Group
          </button>
        </div>

        {groups.length === 0 ? (
          <div className="text-center py-8 text-gray-500 dark:text-gray-400">
            No agent groups configured
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-200 dark:border-gray-700">
                  <th className="text-left py-3 px-4 text-sm font-medium text-gray-700 dark:text-gray-300">Group</th>
                  <th className="text-left py-3 px-4 text-sm font-medium text-gray-700 dark:text-gray-300">Description</th>
                  <th className="text-left py-3 px-4 text-sm font-medium text-gray-700 dark:text-gray-300">Members</th>
                  <th className="text-left py-3 px-4 text-sm font-medium text-gray-700 dark:text-gray-300">Password</th>
                  <th className="text-right py-3 px-4 text-sm font-medium text-gray-700 dark:text-gray-300">Actions</th>
                </tr>
              </thead>
              <tbody>
                {groups.map((group) => (
                  <tr
                    key={group.name}
                    className="border-b border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50 cursor-pointer"
                    onClick={() => setSelectedGroup(selectedGroup === group.name ? null : group.name)}
                  >
                    <td className="py-3 px-4">
                      <div className="flex items-center">
                        {group.is_default && (
                          <span className="mr-2 text-yellow-500">★</span>
                        )}
                        <span className="font-medium text-gray-900 dark:text-gray-100">
                          {group.name}
                        </span>
                      </div>
                    </td>
                    <td className="py-3 px-4 text-sm text-gray-600 dark:text-gray-400">
                      {group.description || '-'}
                    </td>
                    <td className="py-3 px-4 text-sm text-gray-600 dark:text-gray-400">
                      {group.member_count}
                    </td>
                    <td className="py-3 px-4 text-sm">
                      {group.has_password ? (
                        <span className="text-green-600 dark:text-green-400">✓ Set</span>
                      ) : (
                        <span className="text-gray-400">✗ None</span>
                      )}
                    </td>
                    <td className="py-3 px-4">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            openEditModal(group);
                          }}
                          className="px-3 py-1.5 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition-colors"
                        >
                          Edit
                        </button>
                        {!group.is_default && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDeleteGroup(group.name);
                            }}
                            className="px-3 py-1.5 text-sm font-medium bg-red-600 text-white rounded-lg hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 transition-colors"
                          >
                            Delete
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Group Details Panel */}
        {selectedGroup && groupsData && groupsData.agent_groups[selectedGroup] && (
          <div className="mt-6 p-4 bg-gray-50 dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                Group: {selectedGroup}
              </h3>
              <div className="flex gap-2">
                <button
                  onClick={() => openEditModal(groupsData.agent_groups[selectedGroup])}
                  className="px-3 py-1.5 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition-colors"
                >
                  Edit
                </button>
                {!groupsData.agent_groups[selectedGroup].is_default && (
                  <button
                    onClick={() => handleDeleteGroup(selectedGroup)}
                    className="px-3 py-1.5 text-sm font-medium bg-red-600 text-white rounded-lg hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 transition-colors"
                  >
                    Delete
                  </button>
                )}
              </div>
            </div>
            <div className="space-y-3">
              <div>
                <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Description: </span>
                <span className="text-sm text-gray-600 dark:text-gray-400">
                  {groupsData.agent_groups[selectedGroup].description || 'No description'}
                </span>
              </div>
              <div>
                <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Password: </span>
                <span className="text-sm text-gray-600 dark:text-gray-400">
                  {groupsData.agent_groups[selectedGroup].has_password ? '✓ Password set' : '✗ No password'}
                </span>
              </div>
              {groupsData.agent_groups[selectedGroup].permissions.length > 0 && (
                <div>
                  <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Permissions: </span>
                  <div className="flex flex-wrap gap-2 mt-2">
                    {groupsData.agent_groups[selectedGroup].permissions.map((perm, idx) => (
                      <span
                        key={idx}
                        className="px-2 py-1 text-xs bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200 rounded"
                      >
                        {perm}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              {groupsData.agent_groups[selectedGroup].members.length > 0 && (
                <div>
                  <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                    Members ({groupsData.agent_groups[selectedGroup].members.length}):
                  </span>
                  <div className="mt-2 space-y-1">
                    {groupsData.agent_groups[selectedGroup].members.map((member) => (
                      <div
                        key={member}
                        className="text-sm text-gray-600 dark:text-gray-400 flex items-center"
                      >
                        <span className="mr-2">🤖</span>
                        {member}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Create Group Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">
                  Create New Group
                </h2>
                <button
                  onClick={() => setShowCreateModal(false)}
                  className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
                >
                  ✗
                </button>
              </div>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Group Name *
                  </label>
                  <input
                    type="text"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    className="w-full p-3 rounded-lg border bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600 text-gray-900 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="moderators"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Description
                  </label>
                  <textarea
                    value={formData.description}
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                    rows={3}
                    className="w-full p-3 rounded-lg border bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600 text-gray-900 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                    placeholder="Moderator agents with content management permissions"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Password (optional)
                  </label>
                  <input
                    type="password"
                    value={formData.password}
                    onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                    className="w-full p-3 rounded-lg border bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600 text-gray-900 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="••••••••"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Permissions (comma-separated)
                  </label>
                  <input
                    type="text"
                    value={formData.permissions}
                    onChange={(e) => setFormData({ ...formData, permissions: e.target.value })}
                    className="w-full p-3 rounded-lg border bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600 text-gray-900 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="moderate_content, ban_users, view_reports"
                  />
                </div>
                <div className="flex justify-end gap-3 pt-4">
                  <button
                    onClick={() => setShowCreateModal(false)}
                    className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleCreateGroup}
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    Create Group
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Edit Group Modal */}
      {showEditModal && editingGroup && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">
                  Edit Group: {editingGroup.name}
                </h2>
                <button
                  onClick={() => {
                    setShowEditModal(false);
                    setEditingGroup(null);
                  }}
                  className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
                >
                  ✗
                </button>
              </div>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Group Name
                  </label>
                  <input
                    type="text"
                    value={formData.name}
                    disabled
                    className="w-full p-3 rounded-lg border bg-gray-100 dark:bg-gray-700 border-gray-300 dark:border-gray-600 text-gray-500 dark:text-gray-400 cursor-not-allowed"
                  />
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                    Group name cannot be changed after creation
                  </p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Description
                  </label>
                  <textarea
                    value={formData.description}
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                    rows={3}
                    className="w-full p-3 rounded-lg border bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600 text-gray-900 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Password (optional)
                  </label>
                  <input
                    type="password"
                    value={formData.password}
                    onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                    className="w-full p-3 rounded-lg border bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600 text-gray-900 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="Enter new password or leave empty"
                  />
                  <div className="mt-2">
                    <label className="flex items-center">
                      <input
                        type="checkbox"
                        checked={formData.clearPassword}
                        onChange={(e) => setFormData({ ...formData, clearPassword: e.target.checked })}
                        className="mr-2"
                      />
                      <span className="text-sm text-gray-700 dark:text-gray-300">
                        Clear existing password
                      </span>
                    </label>
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Permissions (comma-separated)
                  </label>
                  <input
                    type="text"
                    value={formData.permissions}
                    onChange={(e) => setFormData({ ...formData, permissions: e.target.value })}
                    className="w-full p-3 rounded-lg border bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600 text-gray-900 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div className="flex justify-end gap-3 pt-4">
                  <button
                    onClick={() => {
                      setShowEditModal(false);
                      setEditingGroup(null);
                    }}
                    className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleUpdateGroup}
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    Update Group
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AgentGroupsManagement;

