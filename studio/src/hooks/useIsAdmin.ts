import { useState, useEffect, useRef, useContext } from "react"
import { OpenAgentsContext } from "@/context/OpenAgentsProvider"
import { useAuthStore } from "@/stores/authStore"

interface UseIsAdminResult {
  isAdmin: boolean
  isLoading: boolean
  error: Error | null
}

/**
 * Custom hook to check if current user is an admin
 * Checks if agentName exists in groups.admin array from /api/health
 * Safely handles cases where OpenAgentsProvider is not yet initialized
 */
export const useIsAdmin = (): UseIsAdminResult => {
  const [isAdmin, setIsAdmin] = useState<boolean>(false)
  const [isLoading, setIsLoading] = useState<boolean>(true)
  const [error, setError] = useState<Error | null>(null)
  // Use useContext directly to safely handle undefined context
  const context = useContext(OpenAgentsContext)
  const connector = context?.connector || null
  const { agentName } = useAuthStore()

  // Track if we've ever successfully checked admin status
  const hasCheckedRef = useRef<boolean>(false)

  useEffect(() => {
    const checkAdminStatus = async () => {
      // Keep loading state true until we have both connector and agentName
      if (!connector || !agentName) {
        // Only set loading to false if we've never successfully checked
        // This prevents the menu from flickering
        if (!hasCheckedRef.current) {
          setIsLoading(true)
        }
        return
      }

      try {
        setIsLoading(true)
        setError(null)

        const healthData = await connector.getNetworkHealth()

        if (healthData && healthData.groups && healthData.groups.admin) {
          // Check if current agentName is in the admin group array
          const adminAgents = healthData.groups.admin
          const isUserAdmin =
            Array.isArray(adminAgents) && adminAgents.includes(agentName)
          setIsAdmin(isUserAdmin)
          hasCheckedRef.current = true

          console.log(
            `🔐 Admin check: agentName=${agentName}, isAdmin=${isUserAdmin}`
          )
        } else {
          setIsAdmin(false)
          hasCheckedRef.current = true
        }
      } catch (err) {
        console.error("Failed to check admin status:", err)
        setError(err instanceof Error ? err : new Error("Unknown error"))
        // Don't set isAdmin to false on error if we've previously confirmed admin status
        if (!hasCheckedRef.current) {
          setIsAdmin(false)
        }
      } finally {
        setIsLoading(false)
      }
    }

    checkAdminStatus()
  }, [connector, agentName])

  return { isAdmin, isLoading, error }
}
