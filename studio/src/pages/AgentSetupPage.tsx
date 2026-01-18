import React, { useState, useEffect, useCallback } from "react"
import { useTranslation } from "react-i18next"
import {
  getSavedAgentNameForNetwork,
  saveAgentNameForNetwork,
} from "@/utils/cookies"
import {
  generateRandomAgentName,
  isValidName,
  getAvatarInitials,
} from "@/utils/utils"
import { useAuthStore } from "@/stores/authStore"
import { useNavigate } from "react-router-dom"
import { hashPassword } from "@/utils/passwordHash"
import { networkFetch } from "@/utils/httpClient"
import LanguageSwitcher from "@/components/common/LanguageSwitcher"
import { Button } from "@/components/layout/ui/button"
import { Input, InputGroup, InputAddon } from "@/components/layout/ui/input"
import { Label } from "@/components/layout/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/layout/ui/select"
import { Loader2, RefreshCw, ArrowLeft, User, Lock, Users } from "lucide-react"

// Interface for group configuration from /api/health
interface GroupConfig {
  name: string
  description?: string
  has_password: boolean
  agent_count?: number
  metadata?: Record<string, any>
}

const AgentNamePicker: React.FC = () => {
  const { t } = useTranslation("auth")
  const navigate = useNavigate()
  const {
    selectedNetwork,
    setAgentName,
    clearAgentName,
    clearNetwork,
    setPasswordHash,
    setAgentGroup,
  } = useAuthStore()

  const [pageAgentName, setPageAgentName] = useState<string | null>(null)
  const [savedAgentName, setSavedAgentName] = useState<string | null>(null)
  const [isVerifying, setIsVerifying] = useState<boolean>(false)

  // Admin mode state (separate from group selection)
  const [isAdminMode, setIsAdminMode] = useState<boolean>(false)
  const [adminPassword, setAdminPassword] = useState<string>("")
  const [passwordError, setPasswordError] = useState<string>("")

  // Group selection state
  const [availableGroups, setAvailableGroups] = useState<GroupConfig[]>([])
  const [selectedGroup, setSelectedGroup] = useState<string | null>(null)
  const [defaultGroup, setDefaultGroup] = useState<string>("guest")
  const [isLoadingGroups, setIsLoadingGroups] = useState<boolean>(true)
  const [showAdminButton, setShowAdminButton] = useState<boolean>(false)

  // Password for selected group (non-admin groups that require password)
  const [groupPassword, setGroupPassword] = useState<string>("")

  // Check if current agent name is reserved
  const isReservedAgentName = pageAgentName?.trim().toLowerCase() === "admin"

  const handleRandomize = useCallback(() => {
    setPageAgentName(generateRandomAgentName())
  }, [setPageAgentName])

  // Load saved agent name
  useEffect(() => {
    if (!selectedNetwork) return
    const savedName = getSavedAgentNameForNetwork(
      selectedNetwork.host,
      selectedNetwork.port
    )

    // Ignore "admin" as it's a reserved name
    if (savedName && savedName.toLowerCase() !== "admin") {
      setSavedAgentName(savedName)
      setPageAgentName(savedName)
    } else {
      handleRandomize()
    }
  }, [selectedNetwork, handleRandomize, setPageAgentName])

  // Fetch network configuration and available groups
  useEffect(() => {
    const fetchNetworkConfig = async () => {
      if (!selectedNetwork) return

      setIsLoadingGroups(true)
      try {
        const response = await networkFetch(
          selectedNetwork.host,
          selectedNetwork.port,
          "/api/health",
          {
            method: "GET",
            headers: {
              Accept: "application/json",
            },
            useHttps: selectedNetwork.useHttps,
            networkId: selectedNetwork.networkId,
          }
        )

        if (response.ok) {
          const healthData = await response.json()

          // Extract group configuration
          const groupConfig: GroupConfig[] = healthData.data?.group_config || []
          const defaultGroupName =
            healthData.data?.default_agent_group || "guest"

          // Check if admin group exists
          const hasAdminGroup =
            Array.isArray(groupConfig) &&
            groupConfig.some((group) => group.name === "admin")
          setShowAdminButton(hasAdminGroup)

          // Filter out admin group from available groups for dropdown
          const nonAdminGroups = groupConfig.filter(
            (group) => group.name !== "admin"
          )

          // If no non-admin groups are configured, create a default fallback group
          if (nonAdminGroups.length === 0) {
            const fallbackGroup: GroupConfig = {
              name: defaultGroupName,
              description: t("agentSetup.defaultAgentGroup"),
              has_password: false,
            }
            setAvailableGroups([fallbackGroup])
          } else {
            setAvailableGroups(nonAdminGroups)
          }

          setDefaultGroup(defaultGroupName)

          // Pre-select the default group (if it's not admin)
          const defaultToSelect =
            defaultGroupName !== "admin"
              ? defaultGroupName
              : nonAdminGroups[0]?.name || "guest"
          setSelectedGroup(defaultToSelect)

          console.log("Available groups (excluding admin):", nonAdminGroups)
          console.log("Default group:", defaultGroupName)
          console.log("Has admin group:", hasAdminGroup)
        }
      } catch (error) {
        console.error("Failed to fetch network config:", error)
        // On error, provide a default fallback group so users can still connect
        const fallbackGroupName = "guest"
        const fallbackGroup: GroupConfig = {
          name: fallbackGroupName,
          description: t("agentSetup.defaultAgentGroup"),
          has_password: false,
        }
        setAvailableGroups([fallbackGroup])
        setSelectedGroup(fallbackGroupName)
      } finally {
        setIsLoadingGroups(false)
      }
    }

    fetchNetworkConfig()
  }, [selectedNetwork, t])

  // Get the selected group's configuration
  const selectedGroupConfig = availableGroups.find(
    (g) => g.name === selectedGroup
  )

  // Determine if password is required based on selected group
  const selectedGroupRequiresPassword =
    selectedGroupConfig?.has_password ?? false

  const onBack = useCallback(() => {
    clearAgentName()
    clearNetwork()
  }, [clearAgentName, clearNetwork])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    // Use the page agent name for both regular and admin mode
    const agentNameTrimmed = pageAgentName?.trim()
    if (!agentNameTrimmed || !selectedNetwork) return

    // Validate password requirements
    if (isAdminMode && !adminPassword.trim()) {
      setPasswordError(t("agentSetup.errors.adminPasswordRequired"))
      return
    }

    if (
      !isAdminMode &&
      selectedGroupRequiresPassword &&
      !groupPassword.trim()
    ) {
      setPasswordError(
        t("agentSetup.errors.passwordRequired", { group: selectedGroup })
      )
      return
    }

    setIsVerifying(true)
    setPasswordError("")

    try {
      let passwordHash: string | null = null
      let targetGroup = selectedGroup

      if (isAdminMode) {
        // Hash the password for admin group
        passwordHash = await hashPassword(adminPassword)
        targetGroup = "admin"
        console.log(`Connecting to admin group with password`)
      } else if (selectedGroupRequiresPassword && groupPassword.trim()) {
        // Hash the password for selected group
        passwordHash = await hashPassword(groupPassword)
        console.log(`Connecting to group '${selectedGroup}' with password`)
      } else {
        // No password needed for this group
        console.log(
          `Connecting to group '${selectedGroup}' (no password required)`
        )
      }

      // Verify credentials by attempting registration
      const verifyResponse = await networkFetch(
        selectedNetwork.host,
        selectedNetwork.port,
        "/api/register",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            agent_id: agentNameTrimmed,
            metadata: {
              display_name: agentNameTrimmed,
              platform: "web",
              verification_only: true,
            },
            password_hash: passwordHash || undefined,
            agent_group: targetGroup || undefined,
          }),
          useHttps: selectedNetwork.useHttps,
          networkId: selectedNetwork.networkId,
        }
      )

      const verifyData = await verifyResponse.json()

      if (!verifyData.success) {
        // Registration failed
        const errorMessage =
          verifyData.error_message || t("agentSetup.errors.connectionFailed")
        console.error("Failed to connect:", errorMessage)

        if (isAdminMode) {
          setPasswordError(
            errorMessage.includes("password") ||
              errorMessage.includes("credentials")
              ? t("agentSetup.errors.invalidAdminPassword")
              : errorMessage
          )
        } else if (selectedGroupRequiresPassword) {
          setPasswordError(
            errorMessage.includes("password") ||
              errorMessage.includes("credentials")
              ? t("agentSetup.errors.invalidPassword", { group: selectedGroup })
              : errorMessage
          )
        } else {
          setPasswordError(errorMessage)
        }

        setIsVerifying(false)
        return
      }

      // Registration succeeded - unregister to let the main app re-register
      try {
        await networkFetch(
          selectedNetwork.host,
          selectedNetwork.port,
          "/api/unregister",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              agent_id: agentNameTrimmed,
              secret: verifyData.secret,
            }),
            useHttps: selectedNetwork.useHttps,
            networkId: selectedNetwork.networkId,
          }
        )
      } catch (unregError) {
        // Ignore unregister errors - not critical
        console.warn("Failed to unregister after verification:", unregError)
      }

      // Proceed with connection
      proceedWithConnection(passwordHash, isAdminMode ? "admin" : targetGroup)
    } catch (error) {
      console.error("Failed to verify credentials:", error)
      if (isAdminMode) {
        setPasswordError(t("agentSetup.errors.adminConnectionFailed"))
      } else {
        setPasswordError(t("agentSetup.errors.connectionFailed"))
      }
      setIsVerifying(false)
    }
  }

  const proceedWithConnection = (
    hash: string | null,
    targetGroup: string | null
  ) => {
    // Use the page agent name for all cases
    const agentNameTrimmed = pageAgentName?.trim()
    if (!agentNameTrimmed || !selectedNetwork) return

    // Save the agent name for this network
    saveAgentNameForNetwork(
      selectedNetwork.host,
      selectedNetwork.port,
      agentNameTrimmed
    )

    // Store the password hash and group in authStore
    setPasswordHash(hash)
    setAgentGroup(targetGroup)
    setAgentName(agentNameTrimmed)

    // Navigate based on user type
    if (targetGroup === "admin") {
      // Admin users go directly to admin dashboard
      navigate("/admin/dashboard", { replace: true })
    } else {
      // Regular users go to root - RouteGuard will redirect to the appropriate default route
      // after modules are loaded (which determines if README or messaging is the default)
      navigate("/")
    }
  }

  const handleAdminLogin = () => {
    // Navigate to dedicated admin login page
    navigate("/admin-login")
  }

  const handleExitAdminMode = () => {
    setIsAdminMode(false)
    setAdminPassword("")
    setPasswordError("")
    // Restore to saved name or generate random name
    if (savedAgentName) {
      setPageAgentName(savedAgentName)
    } else {
      handleRandomize()
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-gradient-to-br from-indigo-400 to-purple-500 dark:from-blue-800 dark:to-violet-800">
      <div className="max-w-xl w-full rounded-xl p-8 bg-white shadow-2xl shadow-black/25 dark:bg-gray-800 dark:shadow-black/50 relative">
        {/* Header */}
        <div className="mb-6 flex items-center gap-4">
          {/* Avatar */}
          <div
            className={`w-16 h-16 rounded-full flex items-center justify-center text-white text-2xl font-bold shadow-md border-2 border-white dark:border-gray-800 flex-shrink-0 ${
              isAdminMode
                ? "bg-gradient-to-br from-amber-500 to-orange-600"
                : "bg-gradient-to-br from-blue-500 to-purple-600"
            }`}
          >
            {getAvatarInitials(pageAgentName)}
          </div>
          <div className="flex-1 text-left">
            <h1 className="text-2xl font-bold text-gray-800 dark:text-gray-50">
              {t("agentSetup.title")}
            </h1>
            <p className="text-sm text-gray-500 dark:text-gray-300 mt-1">
              {isAdminMode
                ? t("agentSetup.adminSubtitle")
                : t("agentSetup.subtitle")}
            </p>
          </div>
          <LanguageSwitcher
            showFlag={true}
            showFullName={false}
            variant="minimal"
            align="right"
            size="sm"
            direction="down"
          />
        </div>

        {/* Network Info */}
        <div className="rounded-lg p-3 mb-4 text-left bg-gray-100 dark:bg-gray-700 flex items-center justify-between">
          <div className="text-sm font-medium text-gray-600 dark:text-gray-400">
            {t("agentSetup.connectingTo")}
          </div>
          {selectedNetwork && (
            <div className="text-base font-semibold text-gray-800 dark:text-gray-100">
              {selectedNetwork.networkId ||
                `${selectedNetwork.host}:${selectedNetwork.port}`}
            </div>
          )}
        </div>

        {/* Saved Agent Name Info - Hidden in Admin Mode */}
        {savedAgentName && !isAdminMode && (
          <div className="bg-sky-50 dark:bg-sky-900/20 border border-sky-200 dark:border-sky-800 rounded-lg p-3 mb-4 text-left">
            <div className="text-sm font-medium text-sky-700 dark:text-sky-400">
              {t("agentSetup.previousName")}:{" "}
              <span className="font-semibold text-sky-900 dark:text-sky-100">
                {savedAgentName}
              </span>
            </div>
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Agent Name Input - Hidden in Admin Mode */}
          {!isAdminMode && (
            <div className="space-y-2 text-left">
              <Label htmlFor="agentName">{t("agentSetup.agentName")}</Label>
              <div className="flex gap-3">
                <InputGroup className="flex-1">
                  <InputAddon mode="icon" variant="lg">
                    <User size={16} />
                  </InputAddon>
                  <Input
                    id="agentName"
                    type="text"
                    variant="lg"
                    value={pageAgentName || ""}
                    onChange={(e) => setPageAgentName(e.target.value)}
                    placeholder={t("agentSetup.agentNamePlaceholder")}
                    maxLength={32}
                    autoComplete="off"
                    aria-invalid={isReservedAgentName}
                    className={
                      isReservedAgentName
                        ? "border-red-500 dark:border-red-400"
                        : ""
                    }
                  />
                </InputGroup>
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleRandomize}
                >
                  <RefreshCw className="w-4 h-4 mr-1.5" />
                  {t("agentSetup.buttons.randomName")}
                </Button>
                {savedAgentName && pageAgentName !== savedAgentName && (
                  <Button
                    type="button"
                    variant="primary"
                    onClick={() => setPageAgentName(savedAgentName)}
                  >
                    {t("agentSetup.buttons.usePrevious", {
                      name: savedAgentName,
                    })}
                  </Button>
                )}
              </div>
              {/* Reserved name error */}
              {isReservedAgentName && (
                <div className="text-red-500 dark:text-red-400 text-sm">
                  {t("agentSetup.errors.reservedName", { name: "admin" })}
                </div>
              )}
            </div>
          )}

          {/* Admin Mode: Fixed Admin Name + Password Input */}
          {isAdminMode && (
            <>
              {/* Fixed Admin Name Display */}
              <div className="space-y-2 text-left">
                <Label>{t("agentSetup.agentName")}</Label>
                <div className="w-full px-4 py-3 border border-gray-200 dark:border-gray-600 rounded-lg bg-gray-50 dark:bg-gray-700 text-base font-medium text-gray-800 dark:text-gray-100">
                  admin
                </div>
              </div>

              <div className="space-y-2 text-left">
                <Label htmlFor="adminPassword">
                  {t("agentSetup.adminPassword")}{" "}
                  <span className="text-red-500 ml-1">*</span>
                </Label>
                <InputGroup>
                  <InputAddon mode="icon" variant="lg">
                    <Lock size={16} />
                  </InputAddon>
                  <Input
                    id="adminPassword"
                    type="password"
                    variant="lg"
                    value={adminPassword}
                    onChange={(e) => {
                      setAdminPassword(e.target.value)
                      setPasswordError("")
                    }}
                    className={
                      passwordError ? "border-red-500 dark:border-red-400" : ""
                    }
                    placeholder={t("agentSetup.adminPasswordPlaceholder")}
                    autoComplete="off"
                    required
                    aria-invalid={!!passwordError}
                  />
                </InputGroup>

                {/* Password Error */}
                {passwordError && (
                  <div className="text-red-500 dark:text-red-400 text-sm">
                    {passwordError}
                  </div>
                )}

                {/* Exit Admin Mode Button */}
                <div className="mt-3">
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={handleExitAdminMode}
                  >
                    <ArrowLeft className="w-4 h-4 mr-1.5" />
                    {t("agentSetup.backToRegularLogin")}
                  </Button>
                </div>
              </div>
            </>
          )}

          {/* Regular Mode: Group Selection - Compact */}
          {!isAdminMode && (
            <>
              {/* Agent Group Selection */}
              <div className="space-y-2 text-left">
                <Label htmlFor="agentGroup">{t("agentSetup.agentGroup")}</Label>
                {isLoadingGroups ? (
                  <div className="w-full px-4 py-3 border border-gray-300 dark:border-gray-500 rounded-lg bg-gray-50 dark:bg-gray-600 text-sm text-gray-500 dark:text-gray-400">
                    {t("agentSetup.loadingGroups")}
                  </div>
                ) : (
                  <InputGroup>
                    <InputAddon mode="icon" variant="lg">
                      <Users size={16} />
                    </InputAddon>
                    <Select
                      value={selectedGroup || ""}
                      onValueChange={(value) => {
                        setSelectedGroup(value)
                        setGroupPassword("")
                        setPasswordError("")
                      }}
                    >
                      <SelectTrigger size="lg" className="rounded-l-none">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {availableGroups.map((group) => (
                          <SelectItem key={group.name} value={group.name}>
                            {group.has_password ? "🔒 " : ""}
                            {group.name}
                            {group.name === defaultGroup
                              ? ` (${t("agentSetup.default")})`
                              : ""}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </InputGroup>
                )}
              </div>

              {/* Password Input - Only show if selected group requires password */}
              {selectedGroupRequiresPassword && (
                <div className="space-y-2 text-left">
                  <Label htmlFor="groupPassword">
                    {t("agentSetup.password")}{" "}
                    <span className="text-red-500 ml-1">*</span>
                  </Label>
                  <InputGroup>
                    <InputAddon mode="icon" variant="lg">
                      <Lock size={16} />
                    </InputAddon>
                    <Input
                      id="groupPassword"
                      type="password"
                      variant="lg"
                      value={groupPassword}
                      onChange={(e) => {
                        setGroupPassword(e.target.value)
                        setPasswordError("")
                      }}
                      className={
                        passwordError
                          ? "border-red-500 dark:border-red-400"
                          : ""
                      }
                      placeholder={t("agentSetup.passwordPlaceholder", {
                        group: selectedGroup,
                      })}
                      autoComplete="off"
                      aria-invalid={!!passwordError}
                    />
                  </InputGroup>

                  {/* Password Error */}
                  {passwordError && (
                    <div className="text-red-500 dark:text-red-400 text-sm">
                      {passwordError}
                    </div>
                  )}
                </div>
              )}

              {/* No password required notice */}
              {!selectedGroupRequiresPassword &&
                selectedGroup &&
                !passwordError && (
                  <div className="text-left">
                    <div className="text-sm text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-3">
                      ✓{" "}
                      {t("agentSetup.noPasswordRequired", {
                        group: selectedGroup,
                      })}
                    </div>
                  </div>
                )}

              {/* Error display for non-password errors */}
              {passwordError && !selectedGroupRequiresPassword && (
                <div className="text-left">
                  <div className="text-red-500 dark:text-red-400 text-sm">
                    {passwordError}
                  </div>
                </div>
              )}
            </>
          )}

          {/* Submit Buttons */}
          <div className="flex gap-3 pt-4">
            <Button
              type="button"
              variant="outline"
              onClick={onBack}
              disabled={isVerifying}
              className="flex-1"
            >
              {/* <ArrowLeft className="w-4 h-4 mr-1.5" /> */}
              {t("agentSetup.buttons.back")}
            </Button>
            <Button
              type="submit"
              variant="primary"
              disabled={
                isVerifying ||
                isLoadingGroups ||
                !isValidName(pageAgentName) ||
                (isAdminMode && !adminPassword.trim()) ||
                (!isAdminMode && isReservedAgentName) ||
                (!isAdminMode &&
                  selectedGroupRequiresPassword &&
                  !groupPassword.trim())
              }
              className={`flex-[2] px-6 py-3 border-none rounded-lg text-base font-semibold cursor-pointer transition-all duration-150 text-white ${
                isVerifying ||
                isLoadingGroups ||
                !isValidName(pageAgentName) ||
                (isAdminMode && !adminPassword.trim()) ||
                (!isAdminMode && isReservedAgentName) ||
                (!isAdminMode &&
                  selectedGroupRequiresPassword &&
                  !groupPassword.trim())
                  ? "bg-gray-300 dark:bg-gray-500 cursor-not-allowed"
                  : "bg-blue-500 hover:bg-blue-600 hover:-translate-y-0.5 hover:shadow-lg hover:shadow-blue-500/30"
              }`}
            >
              {isVerifying ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  {t("agentSetup.buttons.connecting")}
                </>
              ) : (
                <>
                  {isAdminMode
                    ? t("agentSetup.buttons.loginAsAdmin")
                    : t("agentSetup.buttons.connect", {
                        name: pageAgentName || "Agent",
                      })}
                  <span className="ml-1">→</span>
                </>
              )}
            </Button>
          </div>
        </form>

        {/* Admin Login Button */}
        {showAdminButton && !isLoadingGroups && !isAdminMode && (
          <>
            <div className="mt-4 mb-3 flex items-center">
              <div className="flex-1 border-t border-gray-300 dark:border-gray-600"></div>
              <span className="px-3 text-sm text-gray-500 dark:text-gray-400">
                {t("agentSetup.or")}
              </span>
              <div className="flex-1 border-t border-gray-300 dark:border-gray-600"></div>
            </div>
            <Button
              type="button"
              variant="outline"
              onClick={handleAdminLogin}
              disabled={isVerifying}
              className="w-full px-6 py-3 border-2 border-blue-500 bg-transparent text-blue-600 dark:text-blue-400 rounded-lg text-base font-semibold cursor-pointer transition-all duration-150 hover:bg-blue-500 hover:text-white disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {t("agentSetup.buttons.loginAsAdmin")}
            </Button>
          </>
        )}
      </div>
    </div>
  )
}

export default AgentNamePicker
