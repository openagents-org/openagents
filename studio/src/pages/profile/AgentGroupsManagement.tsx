import React, { useState, useEffect, useCallback, useMemo } from "react"
import { useTranslation } from "react-i18next"
import { useSearchParams } from "react-router-dom"
import { ColumnDef } from "@tanstack/react-table"
import { useOpenAgents } from "@/context/OpenAgentsProvider"
import { useAuthStore } from "@/stores/authStore"
import { useConfirm } from "@/context/ConfirmContext"
import { Button } from "@/components/layout/ui/button"
import { Badge } from "@/components/layout/ui/badge"
import { Input, InputGroup, InputAddon } from "@/components/layout/ui/input"
import { Label } from "@/components/layout/ui/label"
import { Textarea } from "@/components/layout/ui/textarea"
import {
  Card,
  CardContent,
  CardHeader,
  CardHeading,
  CardTitle,
} from "@/components/layout/ui/card"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogBody,
  DialogFooter,
} from "@/components/layout/ui/dialog"
import { DataTable } from "@/components/layout/ui/data-table"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/layout/ui/select"
import {
  AlertCircle,
  CheckCircle2,
  Users,
  Plus,
  Star,
  Check,
  X,
  Tag,
  Lock,
  Shield,
} from "lucide-react"

interface AgentGroupInfo {
  name: string
  description: string
  has_password: boolean
  member_count: number
  members: string[]
  permissions: string[]
  metadata: Record<string, any>
  is_default: boolean
}

interface NetworkGroupSettings {
  agent_groups: Record<string, AgentGroupInfo>
  default_agent_group: string
  requires_password: boolean
}

const AgentGroupsManagement: React.FC = () => {
  const { t } = useTranslation("network")
  const { connector } = useOpenAgents()
  const { agentName } = useAuthStore()
  const { confirm } = useConfirm()
  const [searchParams, setSearchParams] = useSearchParams()

  const [groupsData, setGroupsData] = useState<NetworkGroupSettings | null>(
    null
  )
  const [loading, setLoading] = useState<boolean>(true)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [selectedGroup, setSelectedGroup] = useState<string | null>(null)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [showEditModal, setShowEditModal] = useState(false)
  const [editingGroup, setEditingGroup] = useState<AgentGroupInfo | null>(null)
  const [showChangePasswordModal, setShowChangePasswordModal] = useState(false)
  const [changingPasswordGroup, setChangingPasswordGroup] = useState<
    string | null
  >(null)
  const [newPassword, setNewPassword] = useState<string>("")
  const [changingPassword, setChangingPassword] = useState<boolean>(false)

  // Network settings
  const [defaultGroup, setDefaultGroup] = useState<string>("")
  const [requiresPassword, setRequiresPassword] = useState<boolean>(false)
  const [savingSettings, setSavingSettings] = useState<boolean>(false)

  // Form state for create/edit
  const [formData, setFormData] = useState({
    name: "",
    description: "",
    password: "",
    clearPassword: false,
    permissions: "",
    metadata: "",
  })

  // Fetch groups data from health check
  const fetchGroupsData = useCallback(async () => {
    if (!connector) {
      setError("Not connected to network")
      setLoading(false)
      return
    }

    try {
      setLoading(true)
      setError(null)

      const healthData = await connector.getNetworkHealth()

      if (healthData && healthData.group_config) {
        const agentGroups: Record<string, AgentGroupInfo> = {}
        const groups = healthData.groups || {}

        for (const groupConfig of healthData.group_config) {
          const groupName = groupConfig.name
          const members = groups[groupName] || []

          agentGroups[groupName] = {
            name: groupName,
            description: groupConfig.description || "",
            has_password: groupConfig.has_password || false,
            member_count: members.length,
            members: members,
            permissions: groupConfig.metadata?.permissions || [],
            metadata: groupConfig.metadata || {},
            is_default: groupName === healthData.default_agent_group,
          }
        }

        setGroupsData({
          agent_groups: agentGroups,
          default_agent_group: healthData.default_agent_group || "guest",
          requires_password: healthData.requires_password || false,
        })

        setDefaultGroup(healthData.default_agent_group || "guest")
        setRequiresPassword(healthData.requires_password || false)
      } else {
        setGroupsData({
          agent_groups: {},
          default_agent_group: "guest",
          requires_password: false,
        })
      }
    } catch (err) {
      console.error("Failed to fetch groups data:", err)
      setError(
        err instanceof Error ? err.message : "Failed to fetch groups data"
      )
    } finally {
      setLoading(false)
    }
  }, [connector])

  useEffect(() => {
    fetchGroupsData()
  }, [fetchGroupsData])

  // Open change password modal
  const openChangePasswordModal = (groupName: string) => {
    setChangingPasswordGroup(groupName)
    setNewPassword("")
    setShowChangePasswordModal(true)
  }

  // Check URL parameter for auto-opening change password modal
  useEffect(() => {
    const changePasswordParam = searchParams.get("changePassword")
    if (changePasswordParam && !loading && groupsData) {
      if (groupsData.agent_groups[changePasswordParam]) {
        openChangePasswordModal(changePasswordParam)
        const newSearchParams = new URLSearchParams(searchParams)
        newSearchParams.delete("changePassword")
        setSearchParams(newSearchParams, { replace: true })
      }
    }
  }, [searchParams, loading, groupsData, setSearchParams])

  // Update agent groups via system event
  const updateAgentGroups = async (action: string, payload: any) => {
    if (!connector || !agentName) {
      setError("Not connected to network")
      return { success: false }
    }

    try {
      const response = await connector.sendEvent({
        event_name: "system.update_agent_groups",
        source_id: agentName,
        payload: {
          agent_id: agentName,
          ...payload,
        },
      })

      if (response.success) {
        if (response.data) {
          setGroupsData({
            agent_groups: response.data.agent_groups || {},
            default_agent_group: response.data.default_agent_group || "guest",
            requires_password: response.data.requires_password || false,
          })
          setDefaultGroup(response.data.default_agent_group || "guest")
          setRequiresPassword(response.data.requires_password || false)
        } else {
          await fetchGroupsData()
        }
        return { success: true, message: response.message }
      } else {
        return {
          success: false,
          message: response.message || "Operation failed",
        }
      }
    } catch (err) {
      console.error("Failed to update agent groups:", err)
      return {
        success: false,
        message: err instanceof Error ? err.message : "Operation failed",
      }
    }
  }

  // Handle create group
  const handleCreateGroup = async () => {
    if (!formData.name.trim()) {
      setError(t("groups.modal.errors.nameRequired"))
      return
    }

    if (!/^[a-zA-Z0-9_]+$/.test(formData.name)) {
      setError(t("groups.modal.errors.nameInvalid"))
      return
    }

    if (formData.name.length > 64) {
      setError(t("groups.modal.errors.nameTooLong"))
      return
    }

    if (formData.description.length > 512) {
      setError(t("groups.modal.errors.descriptionTooLong"))
      return
    }

    // 除了guests角色，其他所有角色都需要必填密码
    const groupNameLower = formData.name.trim().toLowerCase()
    const isGuestGroup = groupNameLower === "guest" || groupNameLower === "guests"
    
    if (!isGuestGroup && !formData.password.trim()) {
      setError(t("groups.modal.errors.passwordRequired"))
      return
    }

    if (formData.password && formData.password.length < 4) {
      setError(t("groups.modal.errors.passwordMinLength"))
      return
    }

    setError(null)
    setSuccess(null)

    const permissions = formData.permissions
      .split(",")
      .map((p) => p.trim())
      .filter((p) => p.length > 0)

    const result = await updateAgentGroups("create", {
      action: "create",
      group_name: formData.name.trim(),
      group_config: {
        description: formData.description.trim(),
        password: formData.password || undefined,
        permissions: permissions,
      },
    })

    if (result.success) {
      setSuccess(t("groups.messages.createSuccess"))
      setError(null)
      setShowCreateModal(false)
      setFormData({
        name: "",
        description: "",
        password: "",
        clearPassword: false,
        permissions: "",
        metadata: "",
      })
    } else {
      setError(result.message || "Failed to create group")
    }
  }

  // Handle update group
  const handleUpdateGroup = async () => {
    if (!editingGroup) return

    if (formData.description.length > 512) {
      setError("Description must be 512 characters or less")
      return
    }

    setError(null)
    setSuccess(null)

    const permissions = formData.permissions
      .split(",")
      .map((p) => p.trim())
      .filter((p) => p.length > 0)

    const groupConfig: any = {
      description: formData.description.trim(),
      permissions: permissions,
    }

    const result = await updateAgentGroups("update", {
      action: "update",
      group_name: editingGroup.name,
      group_config: groupConfig,
    })

    if (result.success) {
      setSuccess(t("groups.messages.updateSuccess"))
      setShowEditModal(false)
      setEditingGroup(null)
      setFormData({
        name: "",
        description: "",
        password: "",
        clearPassword: false,
        permissions: "",
        metadata: "",
      })
    } else {
      setError(result.message || "Failed to update group")
    }
  }

  // Handle change password
  const handleChangePassword = async () => {
    if (!changingPasswordGroup) return

    if (!newPassword.trim()) {
      setError(t("groups.changePassword.modal.passwordRequired"))
      return
    }

    if (newPassword.length < 8) {
      setError(t("groups.changePassword.modal.passwordMinLength"))
      return
    }

    setError(null)
    setSuccess(null)
    setChangingPassword(true)

    try {
      const result = await updateAgentGroups("update", {
        action: "update",
        group_name: changingPasswordGroup,
        group_config: {
          password: newPassword.trim(),
        },
      })

      if (result.success) {
        setSuccess(t("groups.messages.updateSuccess"))
        setShowChangePasswordModal(false)
        setChangingPasswordGroup(null)
        setNewPassword("")
      } else {
        setError(result.message || t("groups.changePassword.modal.failed"))
      }
    } finally {
      setChangingPassword(false)
    }
  }

  // Handle delete group
  const handleDeleteGroup = async (groupName: string) => {
    const confirmed = await confirm(
      t("groups.delete"),
      t("groups.messages.deleteConfirm", { name: groupName })
    )

    if (!confirmed) return

    setError(null)
    setSuccess(null)

    const result = await updateAgentGroups("delete", {
      action: "delete",
      group_name: groupName,
    })

    if (result.success) {
      setSuccess(t("groups.messages.deleteSuccess"))
      if (selectedGroup === groupName) {
        setSelectedGroup(null)
      }
    } else {
      setError(result.message || "Failed to delete group")
    }
  }

  // Handle save network settings
  const handleSaveNetworkSettings = async () => {
    setSavingSettings(true)
    setError(null)
    setSuccess(null)

    try {
      if (defaultGroup !== groupsData?.default_agent_group) {
        const result = await updateAgentGroups("set_default", {
          action: "set_default",
          group_name: defaultGroup,
        })
        if (!result.success) {
          setError(result.message || "Failed to update default group")
          setSavingSettings(false)
          return
        }
      }

      if (requiresPassword !== groupsData?.requires_password) {
        const result = await updateAgentGroups("set_requires_password", {
          action: "set_requires_password",
          requires_password: requiresPassword,
        })
        if (!result.success) {
          setError(result.message || "Failed to update password requirement")
          setSavingSettings(false)
          return
        }
      }

      setSuccess(t("groups.messages.settingsSuccess"))
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save settings")
    } finally {
      setSavingSettings(false)
    }
  }

  // Open edit modal
  const openEditModal = (group: AgentGroupInfo) => {
    setEditingGroup(group)
    setFormData({
      name: group.name,
      description: group.description,
      password: "",
      clearPassword: false,
      permissions: group.permissions.join(", "),
      metadata: JSON.stringify(group.metadata, null, 2),
    })
    setShowEditModal(true)
  }

  // Open create modal
  const openCreateModal = () => {
    setError(null)
    setSuccess(null)
    setFormData({
      name: "",
      description: "",
      password: "",
      clearPassword: false,
      permissions: "",
      metadata: "",
    })
    setShowCreateModal(true)
  }

  // Groups array
  const groups = useMemo(() => {
    return groupsData ? Object.values(groupsData.agent_groups) : []
  }, [groupsData])

  // Define columns for DataTable
  const columns: ColumnDef<AgentGroupInfo>[] = useMemo(
    () => [
      {
        accessorKey: "name",
        header: t("groups.table.group"),
        cell: ({ row }) => {
          const group = row.original
          return (
            <div className="flex items-center">
              {group.is_default && (
                <Star className="w-4 h-4 mr-2 text-yellow-500 fill-yellow-500" />
              )}
              <span className="font-medium text-gray-900 dark:text-gray-100">
                {group.name}
              </span>
            </div>
          )
        },
      },
      {
        accessorKey: "description",
        header: t("groups.table.description"),
        cell: ({ row }) => (
          <span className="text-sm text-gray-600 dark:text-gray-400">
            {row.original.description || "-"}
          </span>
        ),
      },
      {
        accessorKey: "member_count",
        header: t("groups.table.members"),
        cell: ({ row }) => (
          <span className="text-sm text-gray-600 dark:text-gray-400">
            {row.original.member_count}
          </span>
        ),
      },
      {
        accessorKey: "has_password",
        header: () => (
          <div className="text-center">{t("groups.table.password")}</div>
        ),
        cell: ({ row }) => {
          const group = row.original
          return group.has_password ? (
            <div className="flex justify-center items-center text-green-600 dark:text-green-400">
              <Check className="w-4 h-4 mr-1" />
              {t("groups.set")}
            </div>
          ) : (
            <div className="flex justify-center items-center text-gray-400">
              <X className="w-4 h-4 mr-1" />
              {t("groups.none")}
            </div>
          )
        },
      },
      {
        id: "actions",
        header: () => (
          <div className="text-center">{t("groups.table.actions")}</div>
        ),
        cell: ({ row }) => {
          const group = row.original
          return (
            <div className="flex items-center justify-center gap-2">
              <Button
                onClick={(e) => {
                  e.stopPropagation()
                  openEditModal(group)
                }}
                variant="ghost"
                size="sm"
                className="text-blue-600 hover:text-blue-700 dark:text-blue-400"
              >
                {t("groups.edit")}
              </Button>
              {group.has_password && (
                <Button
                  onClick={(e) => {
                    e.stopPropagation()
                    openChangePasswordModal(group.name)
                  }}
                  variant="ghost"
                  size="sm"
                  className="whitespace-nowrap text-amber-600 hover:text-amber-700 dark:text-amber-400"
                >
                  {t("groups.changePassword.button")}
                </Button>
              )}
              {!group.is_default && (
                <Button
                  onClick={(e) => {
                    e.stopPropagation()
                    handleDeleteGroup(group.name)
                  }}
                  variant="ghost"
                  size="sm"
                  className="text-red-600 hover:text-red-700 dark:text-red-400"
                >
                  {t("groups.delete")}
                </Button>
              )}
            </div>
          )
        },
      },
    ],
    [t]
  )

  // Handle row click
  const handleRowClick = (group: AgentGroupInfo) => {
    setSelectedGroup(selectedGroup === group.name ? null : group.name)
  }

  if (loading) {
    return (
      <div className="p-6 dark:bg-gray-800 h-full">
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
          <span className="ml-3 text-gray-600 dark:text-gray-400">
            Loading agent groups...
          </span>
        </div>
      </div>
    )
  }

  return (
    <div className="p-6 dark:bg-zinc-950 h-full min-h-screen overflow-y-auto">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-2">
          {t("groups.title")}
        </h1>
        <p className="text-gray-600 dark:text-gray-400">
          {t("groups.subtitle")}
        </p>
      </div>

      {/* Error/Success Messages */}
      {error && (
        <div className="mb-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
          <div className="flex items-center">
            <AlertCircle className="h-5 w-5 text-red-400 mr-2" />
            <span className="text-sm text-red-800 dark:text-red-200">
              {error}
            </span>
          </div>
        </div>
      )}

      {success && (
        <div className="mb-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-4">
          <div className="flex items-center">
            <CheckCircle2 className="h-5 w-5 text-green-400 mr-2" />
            <span className="text-sm text-green-800 dark:text-green-200">
              {success}
            </span>
          </div>
        </div>
      )}

      {/* Network Settings */}
      <Card variant="default" className="mb-6">
        <CardHeader>
          <CardHeading>
            <CardTitle>{t("groups.networkSettings")}</CardTitle>
          </CardHeading>
        </CardHeader>
        <CardContent>
          <div className="space-y-6">
            {/* Default Group Setting */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-start">
              <div className="space-y-1.5">
                <label className="block text-sm font-semibold text-gray-900 dark:text-gray-100">
                  {t("groups.defaultGroup")}
                </label>
                <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
                  {t("groups.defaultGroupDesc")}
                </p>
              </div>
              <div className="flex items-start md:justify-end">
                <Select value={defaultGroup} onValueChange={setDefaultGroup}>
                  <SelectTrigger size="lg" className="w-full md:w-[240px]">
                    <Users className="w-4 h-4 mr-2 text-gray-400 flex-shrink-0" />
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {groups.map((group) => (
                      <SelectItem key={group.name} value={group.name}>
                        {group.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Require Password Setting */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-start pt-2">
              <div className="space-y-1.5">
                <label className="block text-sm font-semibold text-gray-900 dark:text-gray-100">
                  {t("groups.requirePassword")}
                </label>
                <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
                  {t("groups.requirePasswordDesc")}
                </p>
              </div>
              <div className="flex items-start md:justify-end">
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
            </div>

            {/* Save Button */}
            <div className="flex justify-end pt-4 border-t border-gray-200 dark:border-gray-700">
              <Button
                onClick={handleSaveNetworkSettings}
                disabled={savingSettings}
                variant="primary"
              >
                {savingSettings ? t("groups.saving") : t("groups.saveSettings")}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Agent Groups Table */}
      <DataTable
        columns={columns}
        data={groups}
        loading={loading}
        searchable={true}
        searchPlaceholder={t("groups.searchPlaceholder") || "Search groups..."}
        searchColumn="name"
        pagination={true}
        pageSize={10}
        emptyMessage={t("groups.empty")}
        emptyIcon={<Users className="w-12 h-12 text-gray-400" />}
        onRowClick={handleRowClick}
        toolbar={
          <Button onClick={openCreateModal} variant="primary">
            <Plus className="w-4 h-4 mr-2" />
            {t("groups.create")}
          </Button>
        }
      />

      {/* Group Details Panel */}
      {selectedGroup &&
        groupsData &&
        groupsData.agent_groups[selectedGroup] && (
          <div className="mt-6 p-4 bg-gray-50 dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                {t("groups.table.group")}: {selectedGroup}
              </h3>
              <div className="flex gap-2">
                <Button
                  onClick={() =>
                    openEditModal(groupsData.agent_groups[selectedGroup])
                  }
                  variant="ghost"
                  size="sm"
                  className="text-blue-600 dark:text-blue-400"
                >
                  {t("groups.edit")}
                </Button>
                {!groupsData.agent_groups[selectedGroup].is_default && (
                  <Button
                    onClick={() => handleDeleteGroup(selectedGroup)}
                    variant="ghost"
                    size="sm"
                    className="text-red-600 dark:text-red-400"
                  >
                    {t("groups.delete")}
                  </Button>
                )}
              </div>
            </div>
            <div className="space-y-3">
              <div>
                <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                  Description:{" "}
                </span>
                <span className="text-sm text-gray-600 dark:text-gray-400">
                  {groupsData.agent_groups[selectedGroup].description ||
                    "No description"}
                </span>
              </div>
              <div>
                <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                  {t("groups.table.password")}:{" "}
                </span>
                <span className="text-sm text-gray-600 dark:text-gray-400">
                  {groupsData.agent_groups[selectedGroup].has_password
                    ? `✓ ${t("groups.set")}`
                    : `✗ ${t("groups.none")}`}
                </span>
              </div>
              {groupsData.agent_groups[selectedGroup].permissions.length >
                0 && (
                <div>
                  <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                    Permissions:{" "}
                  </span>
                  <div className="flex flex-wrap gap-2 mt-2">
                    {groupsData.agent_groups[selectedGroup].permissions.map(
                      (perm, idx) => (
                        <Badge
                          key={idx}
                          variant="info"
                          appearance="light"
                          size="sm"
                        >
                          {perm}
                        </Badge>
                      )
                    )}
                  </div>
                </div>
              )}
              {groupsData.agent_groups[selectedGroup].members.length > 0 && (
                <div>
                  <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                    {t("groups.table.members")} (
                    {groupsData.agent_groups[selectedGroup].members.length}):
                  </span>
                  <div className="mt-2 space-y-1">
                    {groupsData.agent_groups[selectedGroup].members.map(
                      (member) => (
                        <div
                          key={member}
                          className="text-sm text-gray-600 dark:text-gray-400 flex items-center"
                        >
                          <span className="mr-2">🤖</span>
                          {member}
                        </div>
                      )
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

      {/* Create Group Modal */}
      <Dialog open={showCreateModal} onOpenChange={setShowCreateModal}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t("groups.modal.createTitle")}</DialogTitle>
          </DialogHeader>
          <DialogBody>
            {error && (
              <div className="mb-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3">
                <div className="flex items-center">
                  <AlertCircle className="h-4 w-4 text-red-400 mr-2 flex-shrink-0" />
                  <span className="text-sm text-red-800 dark:text-red-200">
                    {error}
                  </span>
                </div>
              </div>
            )}
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="group-name">{t("groups.modal.name")} *</Label>
                <InputGroup>
                  <InputAddon mode="icon">
                    <Tag size={16} />
                  </InputAddon>
                  <Input
                    id="group-name"
                    type="text"
                    value={formData.name}
                    onChange={(e) =>
                      setFormData({ ...formData, name: e.target.value })
                    }
                    placeholder={t("groups.modal.namePlaceholder")}
                  />
                </InputGroup>
              </div>
              <div className="space-y-2">
                <Label htmlFor="group-description">
                  {t("groups.modal.description")}
                </Label>
                <Textarea
                  id="group-description"
                  value={formData.description}
                  onChange={(e) =>
                    setFormData({ ...formData, description: e.target.value })
                  }
                  rows={3}
                  placeholder={t("groups.modal.descriptionPlaceholder")}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="group-password">
                  {(() => {
                    const groupNameLower = formData.name.trim().toLowerCase()
                    const isGuestGroup = groupNameLower === "guest" || groupNameLower === "guests"
                    const passwordLabel = t("groups.modal.password")
                    return isGuestGroup ? passwordLabel : `${passwordLabel} *`
                  })()}
                </Label>
                <InputGroup>
                  <InputAddon mode="icon">
                    <Lock size={16} />
                  </InputAddon>
                  <Input
                    id="group-password"
                    type="password"
                    value={formData.password}
                    onChange={(e) =>
                      setFormData({ ...formData, password: e.target.value })
                    }
                    placeholder="••••••••"
                    required={(() => {
                      const groupNameLower = formData.name.trim().toLowerCase()
                      const isGuestGroup = groupNameLower === "guest" || groupNameLower === "guests"
                      return !isGuestGroup
                    })()}
                  />
                </InputGroup>
                {(() => {
                  const groupNameLower = formData.name.trim().toLowerCase()
                  const isGuestGroup = groupNameLower === "guest" || groupNameLower === "guests"
                  return !isGuestGroup ? (
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      {t("groups.modal.passwordRequiredHint")}
                    </p>
                  ) : null
                })()}
              </div>
              <div className="space-y-2">
                <Label htmlFor="group-permissions">
                  {t("groups.modal.permissions")}
                </Label>
                <InputGroup>
                  <InputAddon mode="icon">
                    <Shield size={16} />
                  </InputAddon>
                  <Input
                    id="group-permissions"
                    type="text"
                    value={formData.permissions}
                    onChange={(e) =>
                      setFormData({ ...formData, permissions: e.target.value })
                    }
                    placeholder={t("groups.modal.permissionsPlaceholder")}
                  />
                </InputGroup>
              </div>
            </div>
          </DialogBody>
          <DialogFooter>
            <Button onClick={() => setShowCreateModal(false)} variant="outline">
              {t("groups.modal.cancel")}
            </Button>
            <Button onClick={handleCreateGroup} variant="primary">
              {t("groups.modal.create")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Group Modal */}
      <Dialog
        open={showEditModal}
        onOpenChange={(open) => {
          setShowEditModal(open)
          if (!open) setEditingGroup(null)
        }}
      >
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {t("groups.modal.editTitle", { name: editingGroup?.name })}
            </DialogTitle>
          </DialogHeader>
          <DialogBody>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="edit-group-name">
                  {t("groups.modal.name")}
                </Label>
                <InputGroup>
                  <InputAddon mode="icon">
                    <Tag size={16} />
                  </InputAddon>
                  <Input
                    id="edit-group-name"
                    type="text"
                    value={formData.name}
                    disabled
                  />
                </InputGroup>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  {t("groups.modal.nameCannotChange")}
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-group-description">
                  {t("groups.modal.description")}
                </Label>
                <Textarea
                  id="edit-group-description"
                  value={formData.description}
                  onChange={(e) =>
                    setFormData({ ...formData, description: e.target.value })
                  }
                  rows={3}
                  placeholder={t("groups.modal.descriptionPlaceholder")}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-group-permissions">
                  {t("groups.modal.permissions")}
                </Label>
                <InputGroup>
                  <InputAddon mode="icon">
                    <Shield size={16} />
                  </InputAddon>
                  <Input
                    id="edit-group-permissions"
                    type="text"
                    value={formData.permissions}
                    onChange={(e) =>
                      setFormData({ ...formData, permissions: e.target.value })
                    }
                    placeholder={t("groups.modal.permissionsPlaceholder")}
                  />
                </InputGroup>
              </div>
            </div>
          </DialogBody>
          <DialogFooter>
            <Button
              onClick={() => {
                setShowEditModal(false)
                setEditingGroup(null)
              }}
              variant="outline"
            >
              {t("groups.modal.cancel")}
            </Button>
            <Button onClick={handleUpdateGroup} variant="primary">
              {t("groups.modal.update")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Change Password Modal */}
      <Dialog
        open={showChangePasswordModal}
        onOpenChange={(open) => {
          setShowChangePasswordModal(open)
          if (!open) {
            setChangingPasswordGroup(null)
            setNewPassword("")
          }
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {t("groups.changePassword.modal.title", {
                group: changingPasswordGroup,
              })}
            </DialogTitle>
          </DialogHeader>
          <DialogBody>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="new-password">
                  {t("groups.changePassword.modal.newPasswordLabel")}
                </Label>
                <InputGroup>
                  <InputAddon mode="icon">
                    <Lock size={16} />
                  </InputAddon>
                  <Input
                    id="new-password"
                    type="password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder={t(
                      "groups.changePassword.modal.newPasswordPlaceholder"
                    )}
                    disabled={changingPassword}
                  />
                </InputGroup>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  {t("groups.changePassword.modal.passwordHint")}
                </p>
              </div>
            </div>
          </DialogBody>
          <DialogFooter>
            <Button
              onClick={() => {
                setShowChangePasswordModal(false)
                setChangingPasswordGroup(null)
                setNewPassword("")
              }}
              disabled={changingPassword}
              variant="outline"
            >
              {t("groups.changePassword.modal.cancel")}
            </Button>
            <Button
              onClick={handleChangePassword}
              disabled={changingPassword || !newPassword.trim()}
              variant="primary"
              className="bg-amber-600 hover:bg-amber-700"
            >
              {changingPassword
                ? t("groups.changePassword.modal.changing")
                : t("groups.changePassword.modal.confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

export default AgentGroupsManagement
