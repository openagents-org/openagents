import React, { useState, useCallback, useEffect } from "react"
import { useOpenAgents } from "@/context/OpenAgentsProvider"
import { useAuthStore } from "@/stores/authStore"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import { Label } from "@/components/layout/ui/label"
import { Input, InputGroup, InputAddon } from "@/components/layout/ui/input"
import { Key, Globe, Server, Hash, Building2, Network } from "lucide-react"

// Relay connection info from Python backend
interface RelayConnection {
  connected: boolean
  relay_url: string | null
  tunnel_id: string | null
}

interface ValidationResult {
  success: boolean
  message?: string
  networkName?: string
  onlineAgents?: number
  mods?: string[]
  networkUuid?: string
}

interface PublishedNetwork {
  id: string
  network_uuid?: string
  profile: {
    name: string
    host: string
    port: number
    relay_url?: string
  }
  status: string
  stats: {
    online_agents: number
    views: number
    likes: number
  }
  org: string
  createdAt: string
  updatedAt: string
}

interface PublishingStatus {
  isPublished: boolean
  network?: PublishedNetwork
  loading: boolean
}

interface ApiKeyValidationResult {
  isValid: boolean
  organizationName?: string
  organizationId?: string
  publishedNetworks?: PublishedNetwork[]
  error?: string
}

const OPENAGENTS_API_BASE = "https://endpoint.openagents.org/v1"
const RELAY_URL = "wss://relay.openagents.org"

// List of invalid/private hosts that cannot be used for publishing
const INVALID_HOSTS = ["localhost", "127.0.0.1", "0.0.0.0", "::1", "local"]

// Check if a host is valid for public access
const isValidPublicHost = (
  host: string
): { valid: boolean; reason?: string } => {
  const trimmedHost = host.trim().toLowerCase()

  // Check against invalid hosts
  if (INVALID_HOSTS.includes(trimmedHost)) {
    return { valid: false, reason: "localhost_not_allowed" }
  }

  // Check for private IP ranges
  if (
    /^10\./.test(trimmedHost) ||
    /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(trimmedHost) ||
    /^192\.168\./.test(trimmedHost)
  ) {
    return { valid: false, reason: "private_ip_not_allowed" }
  }

  // Check for .local domains
  if (trimmedHost.endsWith(".local")) {
    return { valid: false, reason: "local_domain_not_allowed" }
  }

  // Check that the host has a valid format (domain or IP)
  // Must have at least one dot for domain names, or be a valid IP
  const ipRegex = /^(\d{1,3}\.){3}\d{1,3}$/
  const domainRegex =
    /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/

  if (!ipRegex.test(trimmedHost) && !domainRegex.test(trimmedHost)) {
    return { valid: false, reason: "invalid_host_format" }
  }

  return { valid: true }
}

const NetworkPublishPage: React.FC = () => {
  const { t } = useTranslation("admin")
  useOpenAgents() // Ensure OpenAgents context is available
  const { selectedNetwork, moduleState } = useAuthStore()

  // API Key state
  const [apiKey, setApiKey] = useState("")
  const [isValidatingApiKey, setIsValidatingApiKey] = useState(false)
  const [apiKeyValidation, setApiKeyValidation] =
    useState<ApiKeyValidationResult | null>(null)

  // Form state
  const [networkId, setNetworkId] = useState("")
  const [networkName, setNetworkName] = useState("")
  const [organization, setOrganization] = useState("")
  const [organizationId, setOrganizationId] = useState("")
  const [networkHost, setNetworkHost] = useState("")
  const [networkPort, setNetworkPort] = useState("")

  // UI state
  const [isValidating, setIsValidating] = useState(false)
  const [isPublishing, setIsPublishing] = useState(false)
  const [validationResult, setValidationResult] =
    useState<ValidationResult | null>(null)
  const [isValidated, setIsValidated] = useState(false)
  const [unpublishingNetworkId, setUnpublishingNetworkId] = useState<
    string | null
  >(null)

  // Relay state (controlled by Python backend)
  const [relayConnection, setRelayConnection] =
    useState<RelayConnection | null>(null)
  const [isConnectingRelay, setIsConnectingRelay] = useState(false)
  const [useRelay, setUseRelay] = useState(false)

  // Publishing status by network_uuid lookup
  const [publishingStatus, setPublishingStatus] = useState<PublishingStatus>({
    isPublished: false,
    loading: false,
  })
  const [currentNetworkUuid, setCurrentNetworkUuid] = useState<string | null>(
    null
  )

  // OpenAgents OAuth state
  const [isAuthenticating, setIsAuthenticating] = useState(false)
  const authPopupRef = React.useRef<Window | null>(null)

  // Authenticated user state (before org selection)
  const [authToken, setAuthToken] = useState<string | null>(null)
  const [userOrganizations, setUserOrganizations] = useState<
    Array<{ id: string; name: string; role: string }>
  >([])
  const [selectedOrgId, setSelectedOrgId] = useState<string>("")
  const [isFetchingApiKey, setIsFetchingApiKey] = useState(false)

  // Check if current host:port is already published
  const existingNetwork = React.useMemo(() => {
    if (!apiKeyValidation?.publishedNetworks || !networkHost || !networkPort) {
      return null
    }
    const port = parseInt(networkPort, 10)
    return (
      apiKeyValidation.publishedNetworks.find(
        (n) => n.profile.host === networkHost && n.profile.port === port
      ) || null
    )
  }, [apiKeyValidation?.publishedNetworks, networkHost, networkPort])

  // Host validation status
  const hostValidation = React.useMemo(() => {
    if (!networkHost.trim()) {
      return null
    }
    // If using relay, the host validation is bypassed
    if (useRelay && relayConnection?.connected) {
      return { valid: true }
    }
    return isValidPublicHost(networkHost)
  }, [networkHost, useRelay, relayConnection])

  // Check if current host is localhost/private (needs relay)
  const isLocalhostNetwork = React.useMemo(() => {
    const host = networkHost.trim().toLowerCase()
    if (!host) return false

    // Check if it's localhost or private
    if (INVALID_HOSTS.includes(host)) return true
    if (
      /^10\./.test(host) ||
      /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(host) ||
      /^192\.168\./.test(host)
    )
      return true
    if (host.endsWith(".local")) return true

    return false
  }, [networkHost])

  // Pre-fill form with current network info
  useEffect(() => {
    if (selectedNetwork) {
      setNetworkHost(selectedNetwork.host || "")
      setNetworkPort(selectedNetwork.port?.toString() || "8700")
    }
    if (moduleState.networkId) {
      setNetworkId(moduleState.networkId)
    }
    if (moduleState.networkName) {
      setNetworkName(moduleState.networkName)
    }
  }, [selectedNetwork, moduleState])

  // Reset validation when form changes
  useEffect(() => {
    setIsValidated(false)
    setValidationResult(null)
    setPublishingStatus({ isPublished: false, loading: false })
    setCurrentNetworkUuid(null)
  }, [networkId, networkHost, networkPort, organization])

  // Lookup publishing status by network_uuid
  const lookupPublishingStatus = useCallback(async (networkUuid: string) => {
    setPublishingStatus({ isPublished: false, loading: true })
    try {
      const response = await fetch(
        `${OPENAGENTS_API_BASE}/networks/lookup?network_uuid=${encodeURIComponent(
          networkUuid
        )}`,
        { signal: AbortSignal.timeout(10000) }
      )
      if (response.ok) {
        const result = await response.json()
        if (result.code === 200 && result.data) {
          setPublishingStatus({
            isPublished: true,
            network: {
              id: result.data.id,
              network_uuid: result.data.network_uuid,
              profile: {
                name: result.data.name,
                host: result.data.host,
                port: result.data.port,
                relay_url: result.data.relay_url,
              },
              status: result.data.status,
              stats: { online_agents: 0, views: 0, likes: 0 },
              org: result.data.org,
              createdAt: "",
              updatedAt: "",
            },
            loading: false,
          })
          return
        }
      }
      setPublishingStatus({ isPublished: false, loading: false })
    } catch (error) {
      console.log("Publishing status lookup failed:", error)
      setPublishingStatus({ isPublished: false, loading: false })
    }
  }, [])

  // Reset API key validation when API key text changes (debounced reset)
  const prevApiKeyRef = React.useRef(apiKey)
  useEffect(() => {
    // Only reset if the key text has actually changed from a previously validated key
    if (prevApiKeyRef.current !== apiKey && apiKeyValidation?.isValid) {
      setApiKeyValidation(null)
      setOrganization("")
      setOrganizationId("")
    }
    prevApiKeyRef.current = apiKey
  }, [apiKey, apiKeyValidation?.isValid])

  // OpenAgents authentication popup handler
  const handleOpenAgentsAuth = useCallback(() => {
    if (isAuthenticating) return

    setIsAuthenticating(true)

    // Open popup to OpenAgents login/callback page
    const width = 500
    const height = 650
    const left = window.screenX + (window.outerWidth - width) / 2
    const top = window.screenY + (window.outerHeight - height) / 2

    const popup = window.open(
      "https://openagents.org/auth/studio",
      "openagents-auth",
      `width=${width},height=${height},left=${left},top=${top},toolbar=no,menubar=no,scrollbars=yes,resizable=yes`
    )

    authPopupRef.current = popup

    // Poll to check if popup is closed
    const pollTimer = setInterval(() => {
      if (popup?.closed) {
        clearInterval(pollTimer)
        setIsAuthenticating(false)
        authPopupRef.current = null
      }
    }, 500)

    // Cleanup after 5 minutes max
    setTimeout(() => {
      clearInterval(pollTimer)
      if (authPopupRef.current && !authPopupRef.current.closed) {
        authPopupRef.current.close()
      }
      setIsAuthenticating(false)
      authPopupRef.current = null
    }, 5 * 60 * 1000)
  }, [isAuthenticating])

  // Fetch API key for selected organization
  const fetchApiKeyForOrg = useCallback(
    async (orgId: string, token: string) => {
      setIsFetchingApiKey(true)
      try {
        const response = await fetch(
          `${OPENAGENTS_API_BASE}/orgs/publishing-credentials?org_id=${encodeURIComponent(
            orgId
          )}`,
          {
            method: "GET",
            headers: {
              Authorization: `Bearer ${token}`,
            },
            signal: AbortSignal.timeout(10000),
          }
        )

        const result = await response.json()

        if (response.ok && result.code === 200 && result.data) {
          const { api_key, org_id, org_name } = result.data

          // Auto-fill the form
          setApiKey(api_key)
          setOrganization(org_name || org_id)
          setOrganizationId(org_id)

          // Set validation result
          setApiKeyValidation({
            isValid: true,
            organizationId: org_id,
            organizationName: org_name || org_id,
            publishedNetworks: [],
          })

          // Clear the auth state since we're now authenticated
          setAuthToken(null)
          setUserOrganizations([])
          setSelectedOrgId("")

          toast.success(
            t(
              "publish.auth.success",
              "Successfully authenticated with OpenAgents!"
            )
          )

          // Fetch published networks for this org
          try {
            const networksResponse = await fetch(
              `${OPENAGENTS_API_BASE}/networks/private`,
              {
                method: "GET",
                headers: {
                  Authorization: `Bearer ${api_key}`,
                },
                signal: AbortSignal.timeout(10000),
              }
            )
            if (networksResponse.ok) {
              const networksResult = await networksResponse.json()
              if (
                networksResult.code === 200 &&
                networksResult.data?.networks
              ) {
                setApiKeyValidation((prev) =>
                  prev
                    ? {
                        ...prev,
                        publishedNetworks: networksResult.data.networks,
                      }
                    : null
                )
              }
            }
          } catch (error) {
            console.log("Failed to fetch published networks:", error)
          }
        } else {
          throw new Error(result.message || "Failed to get API key")
        }
      } catch (error) {
        console.error("Error fetching API key:", error)
        toast.error(
          t("publish.auth.error", "Failed to get API key for organization")
        )
      } finally {
        setIsFetchingApiKey(false)
      }
    },
    [t]
  )

  // Listen for postMessage from OpenAgents auth popup
  useEffect(() => {
    const handleAuthMessage = async (event: MessageEvent) => {
      // Verify origin
      if (event.origin !== "https://openagents.org") return

      // Check message type
      if (event.data?.type === "openagents-auth-success") {
        const { organizations, token } = event.data.payload || {}

        if (organizations && organizations.length > 0 && token) {
          // Store token and organizations for selection
          setAuthToken(token)
          setUserOrganizations(organizations)

          // If only one org, auto-select it
          if (organizations.length === 1) {
            await fetchApiKeyForOrg(organizations[0].id, token)
          } else {
            // Multiple orgs - show selector
            toast.info(
              t(
                "publish.auth.selectOrg",
                "Please select an organization to continue"
              )
            )
          }
        }

        // Close popup
        if (authPopupRef.current && !authPopupRef.current.closed) {
          authPopupRef.current.close()
        }
        setIsAuthenticating(false)
        authPopupRef.current = null
      } else if (event.data?.type === "openagents-auth-error") {
        toast.error(
          event.data.message || t("publish.auth.error", "Authentication failed")
        )
        setIsAuthenticating(false)
        if (authPopupRef.current && !authPopupRef.current.closed) {
          authPopupRef.current.close()
        }
        authPopupRef.current = null
      }
    }

    window.addEventListener("message", handleAuthMessage)
    return () => window.removeEventListener("message", handleAuthMessage)
  }, [t, fetchApiKeyForOrg])

  // Check relay status from Python backend on mount and when network changes
  const checkRelayStatus = useCallback(async () => {
    if (!selectedNetwork) return

    try {
      const protocol = selectedNetwork.useHttps ? "https" : "http"
      const response = await fetch(
        `${protocol}://${selectedNetwork.host}:${selectedNetwork.port}/api/relay/status`,
        { signal: AbortSignal.timeout(5000) }
      )
      if (response.ok) {
        const result = await response.json()
        if (result.success) {
          setRelayConnection({
            connected: result.connected,
            relay_url: result.relay_url,
            tunnel_id: result.tunnel_id,
          })
          setUseRelay(result.connected)
        }
      }
    } catch (error) {
      // Network might not be running, ignore
    }
  }, [selectedNetwork])

  // Check relay status on mount and when network changes
  useEffect(() => {
    checkRelayStatus()
  }, [checkRelayStatus])

  // Connect to relay via Python backend
  const handleConnectRelay = useCallback(async () => {
    if (!selectedNetwork) {
      toast.error(t("publish.errors.networkRequired", "No network selected"))
      return
    }

    setIsConnectingRelay(true)

    try {
      const protocol = selectedNetwork.useHttps ? "https" : "http"
      const response = await fetch(
        `${protocol}://${selectedNetwork.host}:${selectedNetwork.port}/api/relay/connect`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ relay_url: RELAY_URL }),
          signal: AbortSignal.timeout(30000),
        }
      )

      const result = await response.json()

      if (result.success && result.connected) {
        setRelayConnection({
          connected: true,
          relay_url: result.relay_url,
          tunnel_id: result.tunnel_id,
        })
        setUseRelay(true)
        toast.success(
          t(
            "publish.relay.connected",
            "Connected to relay! Your network is now publicly accessible."
          )
        )
      } else {
        toast.error(
          result.error ||
            t("publish.relay.connectionFailed", "Failed to connect to relay")
        )
        setUseRelay(false)
      }
    } catch (error: any) {
      console.error("Relay connection error:", error)
      toast.error(
        error.message ||
          t("publish.relay.connectionFailed", "Failed to connect to relay")
      )
      setUseRelay(false)
    } finally {
      setIsConnectingRelay(false)
    }
  }, [selectedNetwork, t])

  // Disconnect from relay via Python backend
  const handleDisconnectRelay = useCallback(async () => {
    if (!selectedNetwork) return

    try {
      const protocol = selectedNetwork.useHttps ? "https" : "http"
      const response = await fetch(
        `${protocol}://${selectedNetwork.host}:${selectedNetwork.port}/api/relay/disconnect`,
        {
          method: "POST",
          signal: AbortSignal.timeout(10000),
        }
      )

      const result = await response.json()

      if (result.success) {
        setRelayConnection(null)
        setUseRelay(false)
        toast.info(t("publish.relay.disconnected", "Disconnected from relay"))
      } else {
        toast.error(
          result.error ||
            t(
              "publish.relay.disconnectFailed",
              "Failed to disconnect from relay"
            )
        )
      }
    } catch (error: any) {
      console.error("Relay disconnect error:", error)
      toast.error(
        error.message ||
          t("publish.relay.disconnectFailed", "Failed to disconnect from relay")
      )
    }
  }, [selectedNetwork, t])

  // Validate API key and fetch organization info
  const handleValidateApiKey = useCallback(async () => {
    if (!apiKey.trim()) {
      toast.error(t("publish.errors.apiKeyRequired", "API key is required"))
      return
    }

    if (!apiKey.startsWith("oa-")) {
      toast.error(
        t("publish.errors.invalidApiKeyFormat", "API key must start with 'oa-'")
      )
      return
    }

    setIsValidatingApiKey(true)
    setApiKeyValidation(null)

    try {
      // Call the networks/private endpoint to validate API key and get org info
      const response = await fetch(`${OPENAGENTS_API_BASE}/networks/private`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Accept: "application/json",
        },
        signal: AbortSignal.timeout(15000),
      })

      const result = await response.json()

      if (response.ok && result.code === 200) {
        // New response format: { networks: [...], org_id: "...", org_name: "..." }
        const responseData = result.data || {}
        const networks = responseData.networks || []
        const orgName =
          responseData.org_name || (networks.length > 0 ? networks[0].org : "")
        const orgId =
          responseData.org_id || (networks.length > 0 ? networks[0].org_id : "")

        setApiKeyValidation({
          isValid: true,
          organizationName: orgName,
          organizationId: orgId,
          publishedNetworks: networks,
        })

        // Auto-fill organization name and ID
        if (orgName) {
          setOrganization(orgName)
        }
        if (orgId) {
          setOrganizationId(orgId)
        }

        toast.success(
          t("publish.apiKey.validated", "API key validated successfully!")
        )
      } else if (response.status === 401) {
        setApiKeyValidation({
          isValid: false,
          error: t(
            "publish.errors.invalidApiKey",
            "Invalid or expired API key"
          ),
        })
      } else {
        setApiKeyValidation({
          isValid: false,
          error:
            result.message ||
            t(
              "publish.errors.apiKeyValidationFailed",
              "Failed to validate API key"
            ),
        })
      }
    } catch (error: any) {
      console.error("API key validation error:", error)
      setApiKeyValidation({
        isValid: false,
        error:
          error.message ||
          t(
            "publish.errors.apiKeyValidationError",
            "An error occurred while validating API key"
          ),
      })
    } finally {
      setIsValidatingApiKey(false)
    }
  }, [apiKey, t])

  // Validate network configuration
  const handleValidate = useCallback(async () => {
    // Basic validation
    if (!networkId.trim()) {
      toast.error(
        t("publish.errors.networkIdRequired", "Network ID is required")
      )
      return
    }
    if (!networkHost.trim()) {
      toast.error(t("publish.errors.hostRequired", "Host is required"))
      return
    }
    if (!networkPort.trim()) {
      toast.error(t("publish.errors.portRequired", "Port is required"))
      return
    }

    const port = parseInt(networkPort, 10)
    if (isNaN(port) || port < 1 || port > 65535) {
      toast.error(
        t("publish.errors.invalidPort", "Port must be between 1 and 65535")
      )
      return
    }

    if (networkId.length < 7) {
      toast.error(
        t(
          "publish.errors.networkIdTooShort",
          "Network ID must be at least 7 characters"
        )
      )
      return
    }

    // Check if host is valid for public access (skip if using relay)
    if (!useRelay || !relayConnection?.relay_url) {
      const hostCheck = isValidPublicHost(networkHost)
      if (!hostCheck.valid) {
        toast.error(
          t(
            "publish.errors.hostNotPublic",
            "The host must be publicly accessible (no localhost, private IPs, or .local domains)"
          )
        )
        return
      }
    }

    // Check if host:port is already published
    if (existingNetwork) {
      toast.error(
        t(
          "publish.errors.hostPortAlreadyPublished",
          `This host:port is already published as "${existingNetwork.profile.name}". Unpublish it first.`
        )
      )
      return
    }

    if (!organization.trim()) {
      toast.error(
        t("publish.errors.organizationRequired", "Organization is required")
      )
      return
    }

    setIsValidating(true)
    setValidationResult(null)

    try {
      // Determine the validation URL - use relay if connected
      const isUsingRelay = useRelay && relayConnection?.relay_url
      let healthUrl: string
      let validationHost: string
      let validationPort: number

      if (isUsingRelay) {
        // Use the relay public URL for health check
        healthUrl = `${relayConnection.relay_url}/api/health`
        // Parse the relay URL to get host and port for publishing
        const relayUrl = new URL(relayConnection.relay_url)
        validationHost = relayUrl.host
        validationPort = relayUrl.port
          ? parseInt(relayUrl.port, 10)
          : relayUrl.protocol === "https:"
          ? 443
          : 80
      } else {
        // Use HTTPS for standard HTTPS ports (443, 8443) or if explicitly configured
        const isHttpsPort = port === 443 || port === 8443
        const useHttps = isHttpsPort || selectedNetwork?.useHttps
        const protocol = useHttps ? "https" : "http"
        // For port 443, don't include the port in the URL (it's the default for HTTPS)
        healthUrl =
          port === 443
            ? `${protocol}://${networkHost}/api/health`
            : `${protocol}://${networkHost}:${port}/api/health`
        validationHost = networkHost
        validationPort = port
      }

      let healthData: any = null
      try {
        const healthResponse = await fetch(healthUrl, {
          method: "GET",
          headers: {
            Accept: "application/json",
          },
          signal: AbortSignal.timeout(10000),
        })

        if (!healthResponse.ok) {
          setValidationResult({
            success: false,
            message: t(
              "publish.errors.healthCheckFailed",
              `Health check failed with status ${healthResponse.status}`
            ),
          })
          return
        }

        healthData = await healthResponse.json()

        // Capture network_uuid from health response and lookup publishing status
        const networkUuid = healthData?.data?.network_uuid
        if (networkUuid) {
          setCurrentNetworkUuid(networkUuid)
          // Lookup publishing status in background (don't await)
          lookupPublishingStatus(networkUuid)
        }
      } catch (error: any) {
        const targetDesc = isUsingRelay ? "relay" : `${networkHost}:${port}`
        setValidationResult({
          success: false,
          message: t(
            "publish.errors.networkUnreachable",
            `Cannot reach network at ${targetDesc}. Make sure it's running and accessible.`
          ),
        })
        return
      }

      // Step 2: Server-side validation to verify PUBLIC accessibility
      // When using relay, the relay URL is already public, so we validate against that
      if (apiKeyValidation?.isValid && organizationId) {
        // Determine if HTTPS should be used for server-side validation
        const isHttpsPortForValidation =
          validationPort === 443 || validationPort === 8443
        const useHttpsForValidation = isUsingRelay
          ? relayConnection!.relay_url!.startsWith("https")
          : isHttpsPortForValidation || selectedNetwork?.useHttps

        // Call the validate-public endpoint with API key to verify public accessibility from server
        const validateResponse = await fetch(
          `${OPENAGENTS_API_BASE}/networks/validate-public`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/x-www-form-urlencoded",
              Authorization: `Bearer ${apiKey}`,
            },
            body: new URLSearchParams({
              network_id: networkId,
              network_host: validationHost,
              network_port: validationPort.toString(),
              org: organizationId,
              use_https: useHttpsForValidation ? "true" : "false",
              ...(isUsingRelay
                ? { relay_url: relayConnection!.relay_url! }
                : {}),
            }),
            signal: AbortSignal.timeout(25000),
          }
        )

        const validateResult = await validateResponse.json()

        if (validateResponse.ok && validateResult.code === 200) {
          // Server-side validation passed - network is publicly accessible
          const successMessage = isUsingRelay
            ? t(
                "publish.validation.successRelay",
                "Network is accessible via relay and configuration is valid!"
              )
            : t(
                "publish.validation.successPublic",
                "Network is publicly accessible and configuration is valid!"
              )
          setValidationResult({
            success: true,
            message: successMessage,
            networkName: healthData?.data?.network_name || networkName,
            onlineAgents: healthData?.data?.agent_count || 0,
            mods:
              healthData?.data?.mods
                ?.filter((m: any) => m.enabled)
                .map((m: any) => m.name) || [],
            networkUuid: healthData?.data?.network_uuid,
          })
          setIsValidated(true)
          toast.success(
            t("publish.validation.successToast", "Validation successful!")
          )
        } else if (
          validateResponse.status === 401 ||
          validateResponse.status === 403
        ) {
          // Auth error - something wrong with the API key
          setValidationResult({
            success: false,
            message:
              validateResult.message ||
              t(
                "publish.errors.authFailed",
                "Authentication failed. Please check your API key."
              ),
          })
        } else {
          // Server-side validation failed - network is likely not publicly accessible
          setValidationResult({
            success: false,
            message:
              validateResult.message ||
              t(
                "publish.errors.notPubliclyAccessible",
                `Network at ${validationHost}:${validationPort} is not publicly accessible. Make sure your network is exposed to the internet and not behind a firewall.`
              ),
          })
        }
      } else {
        // No API key - try the Firebase-authenticated endpoint (legacy path)
        const response = await fetch(
          `${OPENAGENTS_API_BASE}/networks/validate`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/x-www-form-urlencoded",
            },
            body: new URLSearchParams({
              network_id: networkId,
              network_host: networkHost,
              network_port: port.toString(),
              org: organization,
            }),
            signal: AbortSignal.timeout(15000),
          }
        )

        const result = await response.json()

        if (response.ok && result.code === 200) {
          setValidationResult({
            success: true,
            message: t(
              "publish.validation.success",
              "Network configuration is valid!"
            ),
            networkName: healthData?.data?.network_name || networkName,
            onlineAgents: healthData?.data?.agent_count || 0,
            mods:
              healthData?.data?.mods
                ?.filter((m: any) => m.enabled)
                .map((m: any) => m.name) || [],
            networkUuid: healthData?.data?.network_uuid,
          })
          setIsValidated(true)
          toast.success(
            t("publish.validation.successToast", "Validation successful!")
          )
        } else {
          setValidationResult({
            success: false,
            message:
              result.message ||
              t("publish.errors.validationFailed", "Validation failed"),
          })
        }
      }
    } catch (error: any) {
      console.error("Validation error:", error)
      setValidationResult({
        success: false,
        message:
          error.message ||
          t(
            "publish.errors.validationError",
            "An error occurred during validation"
          ),
      })
    } finally {
      setIsValidating(false)
    }
  }, [
    networkId,
    networkHost,
    networkPort,
    organization,
    organizationId,
    networkName,
    selectedNetwork,
    apiKeyValidation,
    apiKey,
    existingNetwork,
    useRelay,
    relayConnection,
    lookupPublishingStatus,
    t,
  ])

  // Publish network
  const handlePublish = useCallback(async () => {
    if (!isValidated) {
      toast.error(
        t(
          "publish.errors.validateFirst",
          "Please validate the configuration first"
        )
      )
      return
    }

    if (!apiKeyValidation?.isValid) {
      toast.error(
        t(
          "publish.errors.apiKeyNotValidated",
          "Please validate your API key first"
        )
      )
      return
    }

    setIsPublishing(true)

    try {
      const port = parseInt(networkPort, 10)
      const finalNetworkName =
        networkName || validationResult?.networkName || networkId

      // Determine host/port for publishing - use relay if connected
      const isUsingRelay = useRelay && relayConnection?.relay_url
      let publishHost: string
      let publishPort: number
      let description: string

      if (isUsingRelay) {
        const relayUrl = new URL(relayConnection.relay_url)
        publishHost = relayUrl.hostname
        publishPort = relayUrl.port
          ? parseInt(relayUrl.port, 10)
          : relayUrl.protocol === "https:"
          ? 443
          : 80
        description = `Network via relay (original: ${networkHost}:${port})`
      } else {
        publishHost = networkHost
        publishPort = port
        description = `Network at ${networkHost}:${port}`
      }

      // Use the POST /v1/networks/ endpoint with API key authentication
      const networkData = {
        id: networkId,
        profile: {
          name: finalNetworkName,
          description,
          host: publishHost,
          port: publishPort,
          mods: validationResult?.mods || [],
          discoverable: true,
          tags: isUsingRelay ? ["network", "relay"] : ["network"],
          categories: [],
          country: "",
          capacity: 100,
          authentication: { type: "none" },
          // Store relay info for reference
          ...(isUsingRelay ? { relay_url: relayConnection.relay_url } : {}),
        },
      }

      const response = await fetch(`${OPENAGENTS_API_BASE}/networks/`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(networkData),
        signal: AbortSignal.timeout(30000),
      })

      const result = await response.json()

      if (response.ok && (result.code === 200 || result.code === 201)) {
        toast.success(t("publish.success", "Network published successfully!"))
        setIsValidated(false)
        setValidationResult(null)
        // Refresh the published networks list
        handleValidateApiKey()
      } else {
        toast.error(
          result.message ||
            t("publish.errors.publishFailed", "Failed to publish network")
        )
      }
    } catch (error: any) {
      console.error("Publish error:", error)
      toast.error(
        error.message ||
          t("publish.errors.publishError", "An error occurred while publishing")
      )
    } finally {
      setIsPublishing(false)
    }
  }, [
    isValidated,
    apiKeyValidation,
    apiKey,
    networkId,
    networkName,
    networkHost,
    networkPort,
    validationResult,
    handleValidateApiKey,
    useRelay,
    relayConnection,
    t,
  ])

  // Unpublish network
  const handleUnpublish = useCallback(
    async (networkIdToUnpublish: string) => {
      if (!apiKeyValidation?.isValid) {
        toast.error(
          t(
            "publish.errors.apiKeyNotValidated",
            "Please validate your API key first"
          )
        )
        return
      }

      setUnpublishingNetworkId(networkIdToUnpublish)

      try {
        const response = await fetch(
          `${OPENAGENTS_API_BASE}/networks/${networkIdToUnpublish}`,
          {
            method: "DELETE",
            headers: {
              Authorization: `Bearer ${apiKey}`,
            },
            signal: AbortSignal.timeout(30000),
          }
        )

        const result = await response.json()

        if (response.ok && (result.code === 200 || result.code === 204)) {
          toast.success(
            t("publish.unpublish.success", "Network unpublished successfully!")
          )
          // Refresh the published networks list
          handleValidateApiKey()
        } else {
          toast.error(
            result.message ||
              t("publish.unpublish.failed", "Failed to unpublish network")
          )
        }
      } catch (error: any) {
        console.error("Unpublish error:", error)
        toast.error(
          error.message ||
            t("publish.unpublish.error", "An error occurred while unpublishing")
        )
      } finally {
        setUnpublishingNetworkId(null)
      }
    },
    [apiKeyValidation, apiKey, handleValidateApiKey, t]
  )

  return (
    <div className="p-6 h-full overflow-y-auto dark:bg-zinc-950">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
          {t("publish.title")}
        </h1>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
          {t("publish.subtitle")}
        </p>
      </div>

      {/* Form */}
      <div className="space-y-6">
        {/* API Key Section */}
        <div className="bg-white dark:bg-zinc-900 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6 mb-6">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
            {t("publish.apiKey.title", "Authentication")}
          </h2>
          <div className="space-y-4">
            {/* Quick Auth Button */}
            {!apiKeyValidation?.isValid && !userOrganizations.length && (
              <div className="pb-4 border-b border-gray-200 dark:border-gray-700">
                <button
                  type="button"
                  onClick={handleOpenAgentsAuth}
                  disabled={isAuthenticating}
                  className="w-full flex items-center justify-center gap-2 px-4 py-3 text-sm font-medium text-white bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700 rounded-lg shadow-sm disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                >
                  {isAuthenticating ? (
                    <>
                      <svg
                        className="animate-spin h-5 w-5 text-white"
                        fill="none"
                        viewBox="0 0 24 24"
                      >
                        <circle
                          className="opacity-25"
                          cx="12"
                          cy="12"
                          r="10"
                          stroke="currentColor"
                          strokeWidth="4"
                        />
                        <path
                          className="opacity-75"
                          fill="currentColor"
                          d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                        />
                      </svg>
                      {t("publish.auth.authenticating", "Authenticating...")}
                    </>
                  ) : (
                    <>
                      <img
                        src="https://openagents.org/images/logos/openagents_logo_trans_white.png"
                        alt="OpenAgents"
                        className="h-5 w-5 object-contain"
                      />
                      {t("publish.auth.button", "Authenticate with OpenAgents")}
                    </>
                  )}
                </button>
                <p className="mt-2 text-xs text-gray-500 dark:text-gray-400 text-center">
                  {t(
                    "publish.auth.description",
                    "Sign in to OpenAgents to automatically get your API credentials"
                  )}
                </p>

                <div className="relative mt-4">
                  <div className="absolute inset-0 flex items-center">
                    <div className="w-full border-t border-gray-300 dark:border-gray-600"></div>
                  </div>
                  <div className="relative flex justify-center text-xs">
                    <span className="px-2 bg-white dark:bg-zinc-900 text-gray-500 dark:text-gray-400">
                      {t("publish.auth.or", "or enter API key manually")}
                    </span>
                  </div>
                </div>
              </div>
            )}

            {/* Organization Selector - shown after authentication if user has multiple orgs */}
            {!apiKeyValidation?.isValid &&
              userOrganizations.length > 0 &&
              authToken && (
                <div className="pb-4 border-b border-gray-200 dark:border-gray-700">
                  <div className="p-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg mb-4">
                    <div className="flex items-center gap-2 text-green-700 dark:text-green-400">
                      <svg
                        className="w-5 h-5"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M5 13l4 4L19 7"
                        />
                      </svg>
                      <span className="font-medium">
                        {t(
                          "publish.auth.authenticated",
                          "Authenticated successfully!"
                        )}
                      </span>
                    </div>
                  </div>

                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    {t("publish.auth.selectOrgLabel", "Select Organization")}
                  </label>
                  <div className="space-y-2">
                    {userOrganizations.map((org) => (
                      <button
                        key={org.id}
                        type="button"
                        onClick={() => {
                          setSelectedOrgId(org.id)
                          if (authToken) {
                            fetchApiKeyForOrg(org.id, authToken)
                          }
                        }}
                        disabled={isFetchingApiKey}
                        className={`w-full flex items-center justify-between px-4 py-3 rounded-lg border transition-all ${
                          selectedOrgId === org.id
                            ? "border-blue-500 bg-blue-50 dark:bg-blue-900/20"
                            : "border-gray-200 dark:border-gray-600 hover:border-blue-300 dark:hover:border-blue-700"
                        } ${
                          isFetchingApiKey
                            ? "opacity-50 cursor-not-allowed"
                            : ""
                        }`}
                      >
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-full bg-gradient-to-br from-purple-500 to-blue-500 flex items-center justify-center text-white font-semibold">
                            {(org.name || org.id).charAt(0).toUpperCase()}
                          </div>
                          <div className="text-left">
                            <div className="font-medium text-gray-900 dark:text-gray-100">
                              {org.name || org.id}
                            </div>
                            <div className="text-xs text-gray-500 dark:text-gray-400">
                              {org.role} · {org.id}
                            </div>
                          </div>
                        </div>
                        {isFetchingApiKey && selectedOrgId === org.id ? (
                          <svg
                            className="animate-spin h-5 w-5 text-blue-500"
                            fill="none"
                            viewBox="0 0 24 24"
                          >
                            <circle
                              className="opacity-25"
                              cx="12"
                              cy="12"
                              r="10"
                              stroke="currentColor"
                              strokeWidth="4"
                            />
                            <path
                              className="opacity-75"
                              fill="currentColor"
                              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                            />
                          </svg>
                        ) : (
                          <svg
                            className="w-5 h-5 text-gray-400"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M9 5l7 7-7 7"
                            />
                          </svg>
                        )}
                      </button>
                    ))}
                  </div>
                  <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                    {t(
                      "publish.auth.selectOrgHelp",
                      "Select the organization you want to publish your network under"
                    )}
                  </p>

                  <button
                    type="button"
                    onClick={() => {
                      setAuthToken(null)
                      setUserOrganizations([])
                      setSelectedOrgId("")
                    }}
                    className="mt-3 text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300"
                  >
                    {t(
                      "publish.auth.useAnotherAccount",
                      "Use a different account"
                    )}
                  </button>
                </div>
              )}

            {/* API Key Input */}
            <div className="space-y-2">
              <Label htmlFor="apiKey">
                {t("publish.apiKey.label", "API Key")} *
              </Label>
              <div className="flex gap-2">
                <InputGroup className="flex-1">
                  <InputAddon mode="icon">
                    <Key size={16} />
                  </InputAddon>
                  <Input
                    type="password"
                    id="apiKey"
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder={t(
                      "publish.apiKey.placeholder",
                      "oa-xxxxxxxxxxxxxxxx"
                    )}
                    disabled={apiKeyValidation?.isValid}
                  />
                </InputGroup>
                {apiKeyValidation?.isValid ? (
                  <button
                    type="button"
                    onClick={() => {
                      setApiKey("")
                      setApiKeyValidation(null)
                      setOrganization("")
                      setOrganizationId("")
                    }}
                    className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-zinc-700 hover:bg-gray-200 dark:hover:bg-gray-500 rounded-md transition-colors"
                  >
                    {t("publish.apiKey.change", "Change")}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={handleValidateApiKey}
                    disabled={isValidatingApiKey || !apiKey.trim()}
                    className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600 rounded-md disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    {isValidatingApiKey ? (
                      <span className="flex items-center">
                        <svg
                          className="animate-spin -ml-1 mr-2 h-4 w-4 text-white"
                          fill="none"
                          viewBox="0 0 24 24"
                        >
                          <circle
                            className="opacity-25"
                            cx="12"
                            cy="12"
                            r="10"
                            stroke="currentColor"
                            strokeWidth="4"
                          />
                          <path
                            className="opacity-75"
                            fill="currentColor"
                            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                          />
                        </svg>
                        {t("publish.apiKey.validating", "Validating...")}
                      </span>
                    ) : (
                      t("publish.apiKey.validate", "Validate")
                    )}
                  </button>
                )}
              </div>
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                {t(
                  "publish.apiKey.help",
                  "Enter your OpenAgents API key to authenticate. Get one from openagents.org"
                )}
              </p>
            </div>

            {/* API Key Validation Result */}
            {apiKeyValidation && (
              <div
                className={`p-4 rounded-lg ${
                  apiKeyValidation.isValid
                    ? "bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800"
                    : "bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800"
                }`}
              >
                <div className="flex items-start">
                  {apiKeyValidation.isValid ? (
                    <svg
                      className="w-5 h-5 text-green-500 mt-0.5"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M5 13l4 4L19 7"
                      />
                    </svg>
                  ) : (
                    <svg
                      className="w-5 h-5 text-red-500 mt-0.5"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M6 18L18 6M6 6l12 12"
                      />
                    </svg>
                  )}
                  <div className="ml-3 flex-1">
                    {apiKeyValidation.isValid ? (
                      <>
                        <p className="text-sm font-medium text-green-800 dark:text-green-200">
                          {t(
                            "publish.apiKey.validSuccess",
                            "API key validated successfully"
                          )}
                        </p>
                        {apiKeyValidation.organizationName && (
                          <p className="mt-1 text-sm text-green-700 dark:text-green-300">
                            <span className="font-medium">
                              {t(
                                "publish.apiKey.organization",
                                "Organization:"
                              )}
                            </span>{" "}
                            {apiKeyValidation.organizationName}
                          </p>
                        )}
                      </>
                    ) : (
                      <p className="text-sm font-medium text-red-800 dark:text-red-200">
                        {apiKeyValidation.error}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Published Networks List */}
            {apiKeyValidation?.isValid &&
              apiKeyValidation.publishedNetworks &&
              apiKeyValidation.publishedNetworks.length > 0 && (
                <div className="mt-4">
                  <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    {t("publish.publishedNetworks.title", "Published Networks")}
                  </h3>
                  <div className="space-y-2">
                    {apiKeyValidation.publishedNetworks.map((network) => (
                      <div
                        key={network.id}
                        className="p-3 bg-gray-50 dark:bg-zinc-800/50 rounded-lg border border-gray-200 dark:border-gray-600"
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                              {network.profile.name}
                            </p>
                            <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                              {network.id} • {network.profile.host}:
                              {network.profile.port}
                            </p>
                          </div>
                          <div className="flex items-center gap-2 ml-2">
                            <span
                              className={`px-2 py-1 text-xs rounded-full whitespace-nowrap ${
                                network.status === "online"
                                  ? "bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300"
                                  : "bg-gray-100 dark:bg-zinc-700 text-gray-600 dark:text-gray-300"
                              }`}
                            >
                              {network.status}
                            </span>
                            <span className="text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">
                              {network.stats.online_agents}{" "}
                              {t("publish.publishedNetworks.agents", "agents")}
                            </span>
                            <button
                              type="button"
                              onClick={() => handleUnpublish(network.id)}
                              disabled={unpublishingNetworkId === network.id}
                              className="px-2 py-1 text-xs font-medium text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 hover:bg-red-50 dark:hover:bg-red-900/20 rounded disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                            >
                              {unpublishingNetworkId === network.id ? (
                                <span className="flex items-center">
                                  <svg
                                    className="animate-spin h-3 w-3 mr-1"
                                    fill="none"
                                    viewBox="0 0 24 24"
                                  >
                                    <circle
                                      className="opacity-25"
                                      cx="12"
                                      cy="12"
                                      r="10"
                                      stroke="currentColor"
                                      strokeWidth="4"
                                    />
                                    <path
                                      className="opacity-75"
                                      fill="currentColor"
                                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                                    />
                                  </svg>
                                </span>
                              ) : (
                                t("publish.unpublish.button", "Unpublish")
                              )}
                            </button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

            {/* No published networks message */}
            {apiKeyValidation?.isValid &&
              (!apiKeyValidation.publishedNetworks ||
                apiKeyValidation.publishedNetworks.length === 0) && (
                <div className="p-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
                  <div className="flex items-start">
                    <svg
                      className="w-5 h-5 text-blue-500 mt-0.5"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                      />
                    </svg>
                    <p className="ml-3 text-sm text-blue-700 dark:text-blue-300">
                      {t(
                        "publish.publishedNetworks.noNetworks",
                        "No networks published yet. Fill in the form below to publish your first network."
                      )}
                    </p>
                  </div>
                </div>
              )}
          </div>
        </div>

        {/* Network Configuration Form */}
        <div className="bg-white dark:bg-zinc-900 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
            {t("publish.form.title", "Network Configuration")}
          </h2>
          <div className="space-y-6">
            {/* Network ID */}
            <div className="space-y-2">
              <Label htmlFor="networkId">
                {t("publish.form.networkId", "Network ID")} *
              </Label>
              <InputGroup>
                <InputAddon mode="icon">
                  <Hash size={16} />
                </InputAddon>
                <Input
                  type="text"
                  id="networkId"
                  value={networkId}
                  onChange={(e) => setNetworkId(e.target.value)}
                  placeholder={t(
                    "publish.form.networkIdPlaceholder",
                    "e.g., my-awesome-network"
                  )}
                />
              </InputGroup>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                {t(
                  "publish.form.networkIdHelp",
                  "Unique identifier for your network (min 7 characters)"
                )}
              </p>
            </div>

            {/* Network Name */}
            <div className="space-y-2">
              <Label htmlFor="networkName">
                {t("publish.form.networkName", "Network Name")}
              </Label>
              <InputGroup>
                <InputAddon mode="icon">
                  <Network size={16} />
                </InputAddon>
                <Input
                  type="text"
                  id="networkName"
                  value={networkName}
                  onChange={(e) => setNetworkName(e.target.value)}
                  placeholder={t(
                    "publish.form.networkNamePlaceholder",
                    "e.g., My Awesome Network"
                  )}
                />
              </InputGroup>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                {t(
                  "publish.form.networkNameHelp",
                  "Display name for your network (optional, auto-detected from health endpoint)"
                )}
              </p>
            </div>

            {/* Organization */}
            <div className="space-y-2">
              <Label htmlFor="organization">
                {t("publish.form.organization", "Organization")} *
              </Label>
              <InputGroup>
                <InputAddon mode="icon">
                  <Building2 size={16} />
                </InputAddon>
                <Input
                  type="text"
                  id="organization"
                  value={organization}
                  onChange={(e) => setOrganization(e.target.value)}
                  placeholder={t(
                    "publish.form.organizationPlaceholder",
                    "e.g., openagents"
                  )}
                  disabled={apiKeyValidation?.isValid}
                />
              </InputGroup>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                {apiKeyValidation?.isValid
                  ? t(
                      "publish.form.organizationFromApiKey",
                      "Organization is determined by your API key"
                    )
                  : t(
                      "publish.form.organizationHelp",
                      "Your organization identifier on OpenAgents"
                    )}
              </p>
            </div>

            {/* Host and Port */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="networkHost">
                  {t("publish.form.host", "Host")} *
                </Label>
                <InputGroup>
                  <InputAddon mode="icon">
                    <Globe size={16} />
                  </InputAddon>
                  <Input
                    type="text"
                    id="networkHost"
                    value={networkHost}
                    onChange={(e) => setNetworkHost(e.target.value)}
                    placeholder={t(
                      "publish.form.hostPlaceholder",
                      "e.g., mynetwork.example.com"
                    )}
                    aria-invalid={hostValidation && !hostValidation.valid}
                    className={
                      hostValidation && !hostValidation.valid
                        ? "border-red-500 dark:border-red-400"
                        : ""
                    }
                  />
                </InputGroup>
                {hostValidation && !hostValidation.valid && (
                  <p className="text-xs text-red-500 dark:text-red-400">
                    {hostValidation.reason === "localhost_not_allowed" &&
                      t(
                        "publish.errors.localhostNotAllowed",
                        "localhost and local addresses are not allowed. Use a public domain or IP."
                      )}
                    {hostValidation.reason === "private_ip_not_allowed" &&
                      t(
                        "publish.errors.privateIpNotAllowed",
                        "Private IP addresses (10.x.x.x, 172.16-31.x.x, 192.168.x.x) are not allowed."
                      )}
                    {hostValidation.reason === "local_domain_not_allowed" &&
                      t(
                        "publish.errors.localDomainNotAllowed",
                        ".local domains are not allowed. Use a public domain."
                      )}
                    {hostValidation.reason === "invalid_host_format" &&
                      t(
                        "publish.errors.invalidHostFormat",
                        "Invalid host format. Use a valid domain name (e.g., example.com) or public IP address."
                      )}
                  </p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="networkPort">
                  {t("publish.form.port", "Port")} *
                </Label>
                <InputGroup>
                  <InputAddon mode="icon">
                    <Server size={16} />
                  </InputAddon>
                  <Input
                    type="number"
                    id="networkPort"
                    value={networkPort}
                    onChange={(e) => setNetworkPort(e.target.value)}
                    placeholder="8700"
                    min={1}
                    max={65535}
                  />
                </InputGroup>
              </div>
            </div>

            {/* Relay Connection Section - shown when network is on localhost */}
            {isLocalhostNetwork && (
              <div
                className={`p-4 rounded-lg border ${
                  relayConnection?.connected
                    ? "bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800"
                    : "bg-purple-50 dark:bg-purple-900/20 border-purple-200 dark:border-purple-800"
                }`}
              >
                <div className="flex items-start">
                  <svg
                    className={`w-5 h-5 mt-0.5 ${
                      relayConnection?.connected
                        ? "text-green-500"
                        : "text-purple-500"
                    }`}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M13 10V3L4 14h7v7l9-11h-7z"
                    />
                  </svg>
                  <div className="ml-3 flex-1">
                    <p
                      className={`text-sm font-medium ${
                        relayConnection?.connected
                          ? "text-green-800 dark:text-green-200"
                          : "text-purple-800 dark:text-purple-200"
                      }`}
                    >
                      {relayConnection?.connected
                        ? t(
                            "publish.relay.connectedTitle",
                            "Connected via Relay"
                          )
                        : t(
                            "publish.relay.title",
                            "Localhost Network Detected"
                          )}
                    </p>

                    {relayConnection?.connected ? (
                      <>
                        <p className="mt-1 text-sm text-green-700 dark:text-green-300">
                          {t("publish.relay.publicUrl", "Public URL:")}{" "}
                          <code className="px-1 py-0.5 bg-green-100 dark:bg-green-800 rounded text-xs">
                            {relayConnection.relay_url}
                          </code>
                        </p>
                        <button
                          type="button"
                          onClick={handleDisconnectRelay}
                          className="mt-2 px-3 py-1.5 text-sm font-medium text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-md transition-colors"
                        >
                          {t("publish.relay.disconnect", "Disconnect")}
                        </button>
                      </>
                    ) : (
                      <>
                        <p className="mt-1 text-sm text-purple-700 dark:text-purple-300">
                          {t(
                            "publish.relay.description",
                            "Your network is running on localhost and cannot be directly accessed from the internet. Connect via our relay service to make it publicly accessible."
                          )}
                        </p>
                        <div className="mt-3 flex items-center gap-3">
                          <button
                            type="button"
                            onClick={handleConnectRelay}
                            disabled={
                              isConnectingRelay ||
                              !networkId.trim() ||
                              !networkPort.trim()
                            }
                            className="px-4 py-2 text-sm font-medium text-white bg-purple-600 hover:bg-purple-700 dark:bg-purple-500 dark:hover:bg-purple-600 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center"
                          >
                            {isConnectingRelay ? (
                              <>
                                <svg
                                  className="animate-spin -ml-1 mr-2 h-4 w-4 text-white"
                                  fill="none"
                                  viewBox="0 0 24 24"
                                >
                                  <circle
                                    className="opacity-25"
                                    cx="12"
                                    cy="12"
                                    r="10"
                                    stroke="currentColor"
                                    strokeWidth="4"
                                  />
                                  <path
                                    className="opacity-75"
                                    fill="currentColor"
                                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                                  />
                                </svg>
                                {t("publish.relay.connecting", "Connecting...")}
                              </>
                            ) : (
                              <>
                                <svg
                                  className="w-4 h-4 mr-2"
                                  fill="none"
                                  stroke="currentColor"
                                  viewBox="0 0 24 24"
                                >
                                  <path
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    strokeWidth={2}
                                    d="M13 10V3L4 14h7v7l9-11h-7z"
                                  />
                                </svg>
                                {t(
                                  "publish.relay.connect",
                                  "Connect via Relay"
                                )}
                              </>
                            )}
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Already Published Warning */}
            {existingNetwork && (
              <div className="p-4 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg">
                <div className="flex items-start">
                  <svg
                    className="w-5 h-5 text-amber-500 mt-0.5"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                    />
                  </svg>
                  <div className="ml-3">
                    <p className="text-sm font-medium text-amber-800 dark:text-amber-200">
                      {t(
                        "publish.errors.alreadyPublished",
                        "This host:port is already published"
                      )}
                    </p>
                    <p className="mt-1 text-sm text-amber-700 dark:text-amber-300">
                      {t(
                        "publish.errors.alreadyPublishedDetail",
                        'Network "{{name}}" ({{id}}) is already published at {{host}}:{{port}}. You can unpublish it first from the Published Networks list above.',
                        {
                          name: existingNetwork.profile.name,
                          id: existingNetwork.id,
                          host: existingNetwork.profile.host,
                          port: existingNetwork.profile.port,
                        }
                      )}
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* Validation Result */}
            {validationResult && (
              <div
                className={`p-4 rounded-lg ${
                  validationResult.success
                    ? "bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800"
                    : "bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800"
                }`}
              >
                <div className="flex items-start">
                  {validationResult.success ? (
                    <svg
                      className="w-5 h-5 text-green-500 mt-0.5"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M5 13l4 4L19 7"
                      />
                    </svg>
                  ) : (
                    <svg
                      className="w-5 h-5 text-red-500 mt-0.5"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M6 18L18 6M6 6l12 12"
                      />
                    </svg>
                  )}
                  <div className="ml-3">
                    <p
                      className={`text-sm font-medium ${
                        validationResult.success
                          ? "text-green-800 dark:text-green-200"
                          : "text-red-800 dark:text-red-200"
                      }`}
                    >
                      {validationResult.message}
                    </p>
                    {validationResult.success && (
                      <div className="mt-2 text-sm text-green-700 dark:text-green-300">
                        {validationResult.networkName && (
                          <p>
                            <span className="font-medium">
                              {t(
                                "publish.validation.detectedName",
                                "Detected Name:"
                              )}
                            </span>{" "}
                            {validationResult.networkName}
                          </p>
                        )}
                        {validationResult.onlineAgents !== undefined && (
                          <p>
                            <span className="font-medium">
                              {t(
                                "publish.validation.onlineAgents",
                                "Online Agents:"
                              )}
                            </span>{" "}
                            {validationResult.onlineAgents}
                          </p>
                        )}
                        {validationResult.mods &&
                          validationResult.mods.length > 0 && (
                            <p>
                              <span className="font-medium">
                                {t(
                                  "publish.validation.enabledMods",
                                  "Enabled Mods:"
                                )}
                              </span>{" "}
                              {validationResult.mods.join(", ")}
                            </p>
                          )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Publishing Status by Network UUID */}
            {currentNetworkUuid && (
              <div
                className={`p-4 rounded-lg ${
                  publishingStatus.loading
                    ? "bg-gray-50 dark:bg-zinc-950/20 border border-gray-200 dark:border-gray-800"
                    : publishingStatus.isPublished
                    ? "bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800"
                    : "bg-gray-50 dark:bg-gray-900/20 border border-gray-200 dark:border-gray-800"
                }`}
              >
                <div className="flex items-start">
                  {publishingStatus.loading ? (
                    <svg
                      className="w-5 h-5 text-gray-400 mt-0.5 animate-spin"
                      fill="none"
                      viewBox="0 0 24 24"
                    >
                      <circle
                        className="opacity-25"
                        cx="12"
                        cy="12"
                        r="10"
                        stroke="currentColor"
                        strokeWidth="4"
                      ></circle>
                      <path
                        className="opacity-75"
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                      ></path>
                    </svg>
                  ) : publishingStatus.isPublished ? (
                    <svg
                      className="w-5 h-5 text-blue-500 mt-0.5"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                      />
                    </svg>
                  ) : (
                    <svg
                      className="w-5 h-5 text-gray-400 mt-0.5"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M8 12h.01M12 12h.01M16 12h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                      />
                    </svg>
                  )}
                  <div className="ml-3">
                    <p
                      className={`text-sm font-medium ${
                        publishingStatus.isPublished
                          ? "text-blue-800 dark:text-blue-200"
                          : "text-gray-600 dark:text-gray-400"
                      }`}
                    >
                      {publishingStatus.loading
                        ? t(
                            "publish.status.checking",
                            "Checking publishing status..."
                          )
                        : publishingStatus.isPublished
                        ? t(
                            "publish.status.published",
                            "This network is currently published"
                          )
                        : t(
                            "publish.status.notPublished",
                            "This network is not published"
                          )}
                    </p>
                    {publishingStatus.isPublished &&
                      publishingStatus.network && (
                        <div className="mt-1 text-sm text-blue-700 dark:text-blue-300">
                          <p>
                            <span className="font-medium">
                              {t("publish.status.publishedAs", "Published as:")}
                            </span>{" "}
                            {publishingStatus.network.profile.name} (
                            {publishingStatus.network.id})
                          </p>
                          <p>
                            <span className="font-medium">
                              {t("publish.status.org", "Organization:")}
                            </span>{" "}
                            {publishingStatus.network.org}
                          </p>
                          <p>
                            <span className="font-medium">
                              {t("publish.status.status", "Status:")}
                            </span>{" "}
                            <span
                              className={
                                publishingStatus.network.status === "online"
                                  ? "text-green-600 dark:text-green-400"
                                  : "text-yellow-600 dark:text-yellow-400"
                              }
                            >
                              {publishingStatus.network.status}
                            </span>
                          </p>
                        </div>
                      )}
                    {!publishingStatus.loading && (
                      <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                        {t("publish.status.uuidNote", "Network UUID:")}{" "}
                        {currentNetworkUuid}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Missing API Key Warning */}
            {!apiKeyValidation?.isValid && (
              <div className="p-4 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg">
                <div className="flex items-start">
                  <svg
                    className="w-5 h-5 text-yellow-500 mt-0.5"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                    />
                  </svg>
                  <p className="ml-3 text-sm text-yellow-700 dark:text-yellow-300">
                    {t(
                      "publish.errors.apiKeyRequired",
                      "Please validate your API key in the Authentication section above before publishing."
                    )}
                  </p>
                </div>
              </div>
            )}

            {/* Action Buttons */}
            <div className="flex gap-4 pt-4 border-t border-gray-200 dark:border-gray-700">
              <button
                type="button"
                onClick={handleValidate}
                disabled={
                  isValidating ||
                  isPublishing ||
                  !apiKeyValidation?.isValid ||
                  (hostValidation && !hostValidation.valid) ||
                  !!existingNetwork ||
                  (isLocalhostNetwork && !useRelay)
                }
                className="flex-1 px-4 py-2 text-sm font-medium text-white bg-gray-600 hover:bg-gray-700 dark:bg-zinc-600 dark:hover:bg-gray-600 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {isValidating ? (
                  <span className="flex items-center justify-center">
                    <svg
                      className="animate-spin -ml-1 mr-2 h-4 w-4 text-white"
                      fill="none"
                      viewBox="0 0 24 24"
                    >
                      <circle
                        className="opacity-25"
                        cx="12"
                        cy="12"
                        r="10"
                        stroke="currentColor"
                        strokeWidth="4"
                      />
                      <path
                        className="opacity-75"
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                      />
                    </svg>
                    {t("publish.buttons.validating", "Validating...")}
                  </span>
                ) : (
                  t("publish.buttons.validate", "Validate Configuration")
                )}
              </button>

              <button
                type="button"
                onClick={handlePublish}
                disabled={
                  !isValidated ||
                  isPublishing ||
                  isValidating ||
                  !apiKeyValidation?.isValid ||
                  (hostValidation && !hostValidation.valid) ||
                  !!existingNetwork ||
                  (isLocalhostNetwork && !useRelay)
                }
                className="flex-1 px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {isPublishing ? (
                  <span className="flex items-center justify-center">
                    <svg
                      className="animate-spin -ml-1 mr-2 h-4 w-4 text-white"
                      fill="none"
                      viewBox="0 0 24 24"
                    >
                      <circle
                        className="opacity-25"
                        cx="12"
                        cy="12"
                        r="10"
                        stroke="currentColor"
                        strokeWidth="4"
                      />
                      <path
                        className="opacity-75"
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                      />
                    </svg>
                    {t("publish.buttons.publishing", "Publishing...")}
                  </span>
                ) : (
                  t("publish.buttons.publish", "Publish Network")
                )}
              </button>
            </div>
          </div>
        </div>

        {/* Info Box */}
        <div className="mt-6 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
          <div className="flex">
            <svg
              className="w-5 h-5 text-blue-500 mt-0.5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
            <div className="ml-3">
              <h3 className="text-sm font-medium text-blue-800 dark:text-blue-200">
                {t("publish.info.title", "About Publishing")}
              </h3>
              <div className="mt-2 text-sm text-blue-700 dark:text-blue-300 space-y-1">
                <p>
                  {t(
                    "publish.info.point0",
                    "You need an API key from your organization on openagents.org to publish."
                  )}
                </p>
                <p>
                  {t(
                    "publish.info.point1",
                    "Your network must be publicly accessible at the specified host and port."
                  )}
                </p>
                <p>
                  {t(
                    "publish.info.point2",
                    "The health endpoint (/api/health) must be reachable for validation."
                  )}
                </p>
                <p>
                  {t(
                    "publish.info.point3",
                    "Published networks will appear in the OpenAgents directory."
                  )}
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default NetworkPublishPage
