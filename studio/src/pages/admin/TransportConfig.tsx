import React, { useState, useEffect, useCallback } from "react"
import { useTranslation } from "react-i18next"
import { useOpenAgents } from "@/context/OpenAgentsProvider"
import { useAuthStore } from "@/stores/authStore"
import { useConfirm } from "@/context/ConfirmContext"
import { toast } from "sonner"
import { Button } from "@/components/layout/ui/button"
import { Card, CardContent } from "@/components/layout/ui/card"
import { Badge } from "@/components/layout/ui/badge"
import { ScrollArea } from "@/components/layout/ui/scroll-area"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/layout/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/layout/ui/select';
import {
  Globe,
  Terminal,
  Wifi,
  Zap,
  RefreshCw,
  Plus,
  Copy,
  Settings2,
  Trash2,
  Server,
  AlertTriangle,
  LayoutDashboard,
  Blocks,
  Share2,
} from "lucide-react"

interface TransportConfig {
  type: "http" | "grpc" | "websocket" | "mcp"
  enabled: boolean
  port: number
  host: string
  tls?: {
    enabled: boolean
    certPath?: string
    keyPath?: string
  }
  corsOrigins?: string[]
  maxBodySize?: number
  serveMcp?: boolean
  serveStudio?: boolean
  serveA2a?: boolean
  maxMessageSize?: number
  keepAliveInterval?: number
  pingInterval?: number
  maxConnections?: number
}

interface TransportInfo extends TransportConfig {
  url?: string
  connectionCount?: number
}

const TransportConfigPage: React.FC = () => {
  const { t } = useTranslation("admin")
  const { connector } = useOpenAgents()
  const { selectedNetwork } = useAuthStore()
  const { confirm } = useConfirm()

  const [transports, setTransports] = useState<TransportInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [editingTransport, setEditingTransport] =
    useState<TransportInfo | null>(null)
  const [showAddModal, setShowAddModal] = useState(false)
  const [refreshing, setRefreshing] = useState(false)

  const fetchTransports = useCallback(async () => {
    if (!connector) {
      setLoading(false)
      return
    }

    try {
      setRefreshing(true)
      const healthData = await connector.getNetworkHealth()
      const transportsData = healthData?.transports || []

      const transportsList: TransportInfo[] = transportsData.map((t: any) => {
        const config = t.config || {}
        const host = t.host || config.host || selectedNetwork?.host || "0.0.0.0"
        const port = t.port || config.port || 8700
        const tls = t.tls || config.tls
        const protocol = tls?.enabled ? "https" : "http"
        let url = ""

        if (t.type === "http") {
          url = `${protocol}://${
            host === "0.0.0.0" ? "localhost" : host
          }:${port}`
        } else if (t.type === "grpc") {
          url = `${host === "0.0.0.0" ? "localhost" : host}:${port}`
        } else if (t.type === "websocket") {
          const wsProtocol = tls?.enabled ? "wss" : "ws"
          url = `${wsProtocol}://${
            host === "0.0.0.0" ? "localhost" : host
          }:${port}`
        }

        return {
          type: t.type || "http",
          enabled: t.enabled !== false && config.enabled !== false,
          port,
          host,
          url,
          tls,
          corsOrigins:
            t.cors_origins ||
            t.corsOrigins ||
            config.cors_origins ||
            config.corsOrigins,
          maxBodySize:
            t.max_body_size ||
            t.maxBodySize ||
            config.max_body_size ||
            config.maxBodySize,
          serveMcp:
            t.serve_mcp || t.serveMcp || config.serve_mcp || config.serveMcp,
          serveStudio:
            t.serve_studio ||
            t.serveStudio ||
            config.serve_studio ||
            config.serveStudio,
          serveA2a:
            t.serve_a2a ||
            t.serveA2a ||
            config.serve_a2a ||
            config.serveA2a,
          maxMessageSize:
            t.max_message_size ||
            t.maxMessageSize ||
            config.max_message_size ||
            config.maxMessageSize,
          keepAliveInterval:
            t.keepalive_interval ||
            t.keepAliveInterval ||
            config.keepalive_interval ||
            config.keepAliveInterval,
          pingInterval:
            t.ping_interval ||
            t.pingInterval ||
            config.ping_interval ||
            config.pingInterval,
          maxConnections:
            t.max_connections ||
            t.maxConnections ||
            config.max_connections ||
            config.maxConnections,
        }
      })

      if (transportsList.length === 0 && selectedNetwork) {
        transportsList.push({
          type: "http",
          enabled: true,
          port: selectedNetwork.port || 8700,
          host: selectedNetwork.host || "0.0.0.0",
          url: `http://${
            selectedNetwork.host === "0.0.0.0"
              ? "localhost"
              : selectedNetwork.host
          }:${selectedNetwork.port || 8700}`,
        })
      }

      setTransports(transportsList)
    } catch (error) {
      console.error("Failed to fetch transports:", error)
      toast.error(t("transports.toast.loadFailed"))
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [connector, selectedNetwork, t])

  useEffect(() => {
    fetchTransports()
  }, [fetchTransports])

  const handleCopyUrl = (url: string) => {
    navigator.clipboard.writeText(url)
    toast.success(t("transports.toast.urlCopied"))
  }

  const handleToggleTransport = async (transport: TransportInfo) => {
    const action = transport.enabled ? "disable" : "enable"
    const confirmed = await confirm(
      t(
        action === "enable"
          ? "transports.confirm.enableTitle"
          : "transports.confirm.disableTitle"
      ),
      t(
        action === "enable"
          ? "transports.confirm.enableMessage"
          : "transports.confirm.disableMessage",
        { type: transport.type.toUpperCase() }
      ),
      {
        type: "warning",
        confirmText: t(
          action === "enable"
            ? "transports.confirm.enable"
            : "transports.confirm.disable"
        ),
      }
    )

    if (!confirmed) return

    toast.info(t("transports.toast.toggleRequested", { action }))
    setTransports((prev) =>
      prev.map((t) =>
        t.type === transport.type ? { ...t, enabled: !t.enabled } : t
      )
    )
  }

  const handleDeleteTransport = async (transport: TransportInfo) => {
    const confirmed = await confirm(
      t("transports.confirm.deleteTitle"),
      t("transports.confirm.deleteMessage", {
        type: transport.type.toUpperCase(),
      }),
      {
        type: "danger",
        confirmText: t("transports.confirm.delete"),
      }
    )

    if (!confirmed) return

    toast.info(t("transports.toast.deleteRequested"))
    setTransports((prev) => prev.filter((t) => t.type !== transport.type))
  }

  const handleSaveTransport = (updatedTransport: TransportInfo) => {
    toast.info(t("transports.toast.saveRequested"))
    setTransports((prev) =>
      prev.map((t) => (t.type === updatedTransport.type ? updatedTransport : t))
    )
    setEditingTransport(null)
  }

  const handleAddTransport = (newTransport: TransportInfo) => {
    toast.info(t("transports.toast.addRequested"))
    setTransports((prev) => [...prev, newTransport])
    setShowAddModal(false)
  }

  const getTransportIcon = (type: string) => {
    switch (type) {
      case "http":
        return <Globe className="w-5 h-5" />
      case "grpc":
        return <Terminal className="w-5 h-5" />
      case "websocket":
        return <Wifi className="w-5 h-5" />
      default:
        return <Zap className="w-5 h-5" />
    }
  }

  const getTransportColor = (type: string, enabled: boolean) => {
    if (!enabled) return "bg-gray-100 dark:bg-gray-800 text-gray-400"
    switch (type) {
      case "http":
        return "bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400"
      case "grpc":
        return "bg-purple-50 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400"
      case "websocket":
        return "bg-green-50 dark:bg-green-900/30 text-green-600 dark:text-green-400"
      default:
        return "bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400"
    }
  }

  if (loading) {
    return (
      <div className="p-6 h-full flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-3"></div>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {t("transports.loading")}
          </p>
        </div>
      </div>
    )
  }

  return (
    <ScrollArea className="h-full">
      <div className="p-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
              {t("transports.title")}
            </h1>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
              {t("transports.subtitle")}
            </p>
          </div>

          <div className="flex items-center gap-2">
            <Button
              onClick={fetchTransports}
              disabled={refreshing}
              variant="outline"
              size="sm"
            >
              <RefreshCw
                className={`w-4 h-4 mr-1.5 ${refreshing ? "animate-spin" : ""}`}
              />
              {refreshing
                ? t("transports.refreshing")
                : t("transports.refresh")}
            </Button>

            <Button
              onClick={() => setShowAddModal(true)}
              variant="primary"
              size="sm"
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white disabled:bg-gray-400"
            >
              <Plus className="w-4 h-4 mr-1.5" />
              {t("transports.addNew")}
            </Button>
          </div>
        </div>

        {/* Network Info Badge */}
        {selectedNetwork && (
          <div className="mb-4">
            <Badge
              variant="info"
              appearance="light"
              size="sm"
              className="gap-1.5"
            >
              <Server className="w-3.5 h-3.5" />
              {t("transports.network")}: {selectedNetwork.host}:
              {selectedNetwork.port}
            </Badge>
          </div>
        )}

        {/* Warning Banner */}
        <Card className="mb-4 border-amber-200 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-900/10">
          <CardContent className="p-3 flex items-start gap-2.5">
            <AlertTriangle className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-amber-800 dark:text-amber-200">
                {t("transports.warning.title")}
              </p>
              <p className="text-xs text-amber-700 dark:text-amber-300 mt-0.5">
                {t("transports.warning.description")}
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Transport Cards */}
        <div className="space-y-3">
          {transports.length === 0 ? (
            <Card className="border-dashed">
              <CardContent className="py-12 text-center">
                <Server className="w-10 h-10 mx-auto text-gray-300 dark:text-gray-600 mb-3" />
                <p className="text-gray-500 dark:text-gray-400">
                  {t("transports.empty")}
                </p>
              </CardContent>
            </Card>
          ) : (
            transports.map((transport) => (
              <Card
                key={transport.type}
                className="border-gray-200 dark:border-gray-700 overflow-hidden"
              >
                <CardContent className="p-0">
                  {/* Card Header */}
                  <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 dark:border-gray-700/50">
                    <div className="flex items-center gap-3">
                      <div
                        className={`p-2 rounded-lg ${getTransportColor(
                          transport.type,
                          transport.enabled
                        )}`}
                      >
                        {getTransportIcon(transport.type)}
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <h3 className="font-medium text-gray-900 dark:text-gray-100">
                            {transport.type.toUpperCase()}{" "}
                            {t("transports.card.transport")}
                          </h3>
                          <span
                            className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                              transport.enabled
                                ? "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400"
                                : "bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400"
                            }`}
                          >
                            {transport.enabled
                              ? t("transports.card.enabled")
                              : t("transports.card.disabled")}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Toggle Switch */}
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input
                        type="checkbox"
                        checked={transport.enabled}
                        onChange={() => handleToggleTransport(transport)}
                        className="sr-only peer"
                      />
                      <div className="w-10 h-5 bg-gray-200 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-blue-300 dark:peer-focus:ring-blue-800 rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all dark:border-gray-600 peer-checked:bg-blue-600"></div>
                    </label>
                  </div>

                  {/* Card Body */}
                  <div className="px-4 py-3">
                    {/* Info Grid */}
                    <div className="grid grid-cols-3 gap-4 text-sm">
                      <div>
                        <span className="text-gray-500 dark:text-gray-400 text-xs uppercase tracking-wide">
                          {t("transports.card.port")}
                        </span>
                        <p className="font-medium text-gray-900 dark:text-gray-100 mt-0.5">
                          {transport.port}
                        </p>
                      </div>
                      <div>
                        <span className="text-gray-500 dark:text-gray-400 text-xs uppercase tracking-wide">
                          {t("transports.card.host")}
                        </span>
                        <p className="font-medium text-gray-900 dark:text-gray-100 mt-0.5">
                          {transport.host}
                        </p>
                      </div>
                      {transport.url && (
                        <div>
                          <span className="text-gray-500 dark:text-gray-400 text-xs uppercase tracking-wide">
                            URL
                          </span>
                          <div className="flex items-center gap-1.5 mt-0.5">
                            <code className="text-xs font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-800 px-1.5 py-0.5 rounded truncate max-w-[180px]">
                              {transport.url}
                            </code>
                            <button
                              onClick={() => handleCopyUrl(transport.url!)}
                              className="p-1 text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors"
                              title={t("transports.card.copyUrl")}
                            >
                              <Copy className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* HTTP Features - Services served by this transport */}
                    {transport.type === "http" &&
                      (transport.serveMcp || transport.serveStudio || transport.serveA2a) && (
                        <div className="mt-3 pt-3 border-t border-gray-100 dark:border-gray-700/50">
                          <div className="text-xs text-gray-500 dark:text-gray-400 mb-2 font-medium uppercase tracking-wide">
                            Serving
                          </div>
                          <div className="flex flex-wrap items-center gap-2">
                            {transport.serveMcp && (
                              <div className="flex items-center gap-1.5 px-2.5 py-1.5 bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-800 rounded-md">
                                <Blocks className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                                <span className="text-xs font-medium text-blue-700 dark:text-blue-300">MCP Server</span>
                              </div>
                            )}
                            {transport.serveA2a && (
                              <div className="flex items-center gap-1.5 px-2.5 py-1.5 bg-green-50 dark:bg-green-900/30 border border-green-200 dark:border-green-800 rounded-md">
                                <Share2 className="w-3.5 h-3.5 text-green-600 dark:text-green-400" />
                                <span className="text-xs font-medium text-green-700 dark:text-green-300">A2A Server</span>
                              </div>
                            )}
                            {transport.serveStudio && (
                              <div className="flex items-center gap-1.5 px-2.5 py-1.5 bg-purple-50 dark:bg-purple-900/30 border border-purple-200 dark:border-purple-800 rounded-md">
                                <LayoutDashboard className="w-3.5 h-3.5 text-purple-600 dark:text-purple-400" />
                                <span className="text-xs font-medium text-purple-700 dark:text-purple-300">Studio UI</span>
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                  </div>

                  {/* Card Footer */}
                  <div className="flex items-center justify-end gap-1 px-3 py-2 bg-gray-50 dark:bg-gray-800/50 border-t border-gray-100 dark:border-gray-700/50">
                    <Button
                      onClick={() => setEditingTransport(transport)}
                      variant="ghost"
                      size="sm"
                    >
                      <Settings2 className="w-4 h-4 mr-1.5" />
                      {t("transports.card.editConfig")}
                    </Button>
                    <Button
                      onClick={() => handleDeleteTransport(transport)}
                      variant="ghost"
                      size="sm"
                      className="text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 hover:bg-red-50 dark:hover:bg-red-900/20"
                    >
                      <Trash2 className="w-4 h-4 mr-1.5" />
                      {t("transports.card.remove")}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </div>
      </div>

      {/* Edit Modal */}
      <Dialog
        open={!!editingTransport}
        onOpenChange={(open) => !open && setEditingTransport(null)}
      >
        <DialogContent className="max-w-lg bg-white dark:bg-gray-900">
          <DialogHeader>
            <DialogTitle className="text-gray-900 dark:text-gray-100">
              {t("transports.edit.title", {
                type: editingTransport?.type.toUpperCase(),
              })}
            </DialogTitle>
            <DialogDescription className="text-gray-500 dark:text-gray-400">
              {t("transports.edit.description")}
            </DialogDescription>
          </DialogHeader>

          {editingTransport && (
            <TransportEditForm
              transport={editingTransport}
              onSave={handleSaveTransport}
              onCancel={() => setEditingTransport(null)}
            />
          )}
        </DialogContent>
      </Dialog>

      {/* Add Modal */}
      <Dialog open={showAddModal} onOpenChange={setShowAddModal}>
        <DialogContent className="max-w-lg bg-white dark:bg-gray-900">
          <DialogHeader>
            <DialogTitle className="text-gray-900 dark:text-gray-100">
              {t("transports.add.title")}
            </DialogTitle>
            <DialogDescription className="text-gray-500 dark:text-gray-400">
              {t("transports.add.description")}
            </DialogDescription>
          </DialogHeader>

          <TransportAddForm
            existingTypes={transports.map((t) => t.type)}
            onSave={handleAddTransport}
            onCancel={() => setShowAddModal(false)}
          />
        </DialogContent>
      </Dialog>
    </ScrollArea>
  )
}

// Transport Edit Form Component
interface TransportEditFormProps {
  transport: TransportInfo
  onSave: (transport: TransportInfo) => void
  onCancel: () => void
}

const TransportEditForm: React.FC<TransportEditFormProps> = ({
  transport,
  onSave,
  onCancel,
}) => {
  const { t } = useTranslation("admin")
  const [formData, setFormData] = useState<TransportInfo>({ ...transport })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    onSave(formData)
  }

  return (
    <form onSubmit={handleSubmit}>
      <div className="space-y-4 py-2">
        {/* Port */}
        <div className="space-y-1.5">
          <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
            {t("transports.edit.port")}
          </label>
          <input
            type="number"
            value={formData.port}
            onChange={(e) =>
              setFormData({ ...formData, port: parseInt(e.target.value) || 0 })
            }
            min="1"
            max="65535"
            className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            required
          />
        </div>

        {/* Host */}
        <div className="space-y-1.5">
          <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
            {t("transports.edit.host")}
          </label>
          <input
            type="text"
            value={formData.host}
            onChange={(e) => setFormData({ ...formData, host: e.target.value })}
            className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            required
          />
        </div>

        {/* HTTP-specific fields */}
        {formData.type === "http" && (
          <>
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                {t("transports.edit.corsOrigins")}
              </label>
              <input
                type="text"
                value={formData.corsOrigins?.join(", ") || ""}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    corsOrigins: e.target.value
                      .split(",")
                      .map((s) => s.trim())
                      .filter(Boolean),
                  })
                }
                className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder={t("transports.edit.corsPlaceholder")}
              />
            </div>

            <div className="flex flex-col gap-2.5 pt-2">
              <label className="flex items-center gap-2.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={formData.serveMcp || false}
                  onChange={(e) =>
                    setFormData({ ...formData, serveMcp: e.target.checked })
                  }
                  className="w-4 h-4 rounded border-gray-300 dark:border-gray-600 text-blue-600 focus:ring-blue-500"
                />
                <span className="text-sm text-gray-700 dark:text-gray-300">
                  {t("transports.edit.serveMcp")}
                </span>
              </label>
              <label className="flex items-center gap-2.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={formData.serveA2a || false}
                  onChange={(e) =>
                    setFormData({ ...formData, serveA2a: e.target.checked })
                  }
                  className="w-4 h-4 rounded border-gray-300 dark:border-gray-600 text-blue-600 focus:ring-blue-500"
                />
                <span className="text-sm text-gray-700 dark:text-gray-300">
                  {t("transports.edit.serveA2a")}
                </span>
              </label>
              <label className="flex items-center gap-2.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={formData.serveStudio || false}
                  onChange={(e) =>
                    setFormData({ ...formData, serveStudio: e.target.checked })
                  }
                  className="w-4 h-4 rounded border-gray-300 dark:border-gray-600 text-blue-600 focus:ring-blue-500"
                />
                <span className="text-sm text-gray-700 dark:text-gray-300">
                  {t("transports.edit.serveStudio")}
                </span>
              </label>
            </div>
          </>
        )}

        {/* gRPC-specific fields */}
        {formData.type === "grpc" && (
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
              {t("transports.edit.maxMessageSize")}
            </label>
            <input
              type="number"
              value={formData.maxMessageSize || 104857600}
              onChange={(e) =>
                setFormData({
                  ...formData,
                  maxMessageSize: parseInt(e.target.value) || 0,
                })
              }
              className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>
        )}

        {/* WebSocket-specific fields */}
        {formData.type === "websocket" && (
          <>
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                {t("transports.edit.pingInterval")}
              </label>
              <input
                type="number"
                value={formData.pingInterval || 30000}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    pingInterval: parseInt(e.target.value) || 0,
                  })
                }
                className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                {t("transports.edit.maxConnections")}
              </label>
              <input
                type="number"
                value={formData.maxConnections || 100}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    maxConnections: parseInt(e.target.value) || 0,
                  })
                }
                className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
          </>
        )}
      </div>

      <div className="flex items-center justify-end gap-3 pt-6 mt-6 border-t border-gray-200 dark:border-gray-700">
        <Button
          type="button"
          variant="outline"
          onClick={onCancel}
          className="px-4 py-2"
        >
          {t("transports.edit.cancel")}
        </Button>
        <Button
          type="submit"
          variant="primary"
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white"
        >
          {t("transports.edit.save")}
        </Button>
      </div>
    </form>
  )
}

// Transport Add Form Component
interface TransportAddFormProps {
  existingTypes: string[]
  onSave: (transport: TransportInfo) => void
  onCancel: () => void
}

const TransportAddForm: React.FC<TransportAddFormProps> = ({
  existingTypes,
  onSave,
  onCancel,
}) => {
  const { t } = useTranslation("admin")
  const availableTypes: ("http" | "grpc" | "websocket")[] = [
    "http",
    "grpc",
    "websocket",
  ]
  const [selectedType, setSelectedType] = useState<
    "http" | "grpc" | "websocket"
  >("http")
  const [port, setPort] = useState(8700)
  const [host, setHost] = useState("0.0.0.0")

  const getDefaultPort = (type: string): number => {
    switch (type) {
      case "http":
        return 8700
      case "grpc":
        return 8600
      case "websocket":
        return 8400
      default:
        return 8700
    }
  }

  const handleTypeChange = (type: "http" | "grpc" | "websocket") => {
    setSelectedType(type)
    setPort(getDefaultPort(type))
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    onSave({
      type: selectedType,
      enabled: true,
      port,
      host,
    })
  }

  const filteredTypes = availableTypes.filter(
    (type) => !existingTypes.includes(type)
  )

  return (
    <form onSubmit={handleSubmit}>
      <div className="space-y-4 py-2">
        {/* Type */}
        <div className="space-y-1.5">
          <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
            {t("transports.add.type")}
          </label>
          {filteredTypes.length > 0 ? (
            <Select
              value={selectedType}
              onValueChange={(value) =>
                handleTypeChange(value as "http" | "grpc" | "websocket")
              }
            >
              <SelectTrigger size="lg" className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-blue-500 focus:border-transparent">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {filteredTypes.map((type) => (
                  <SelectItem key={type} value={type}>
                    {type.toUpperCase()}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <p className="text-sm text-amber-600 dark:text-amber-400">
              {t("transports.add.allTypesExist")}
            </p>
          )}
        </div>

        {/* Port */}
        <div className="space-y-1.5">
          <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
            {t("transports.add.port")}
          </label>
          <input
            type="number"
            value={port}
            onChange={(e) => setPort(parseInt(e.target.value) || 0)}
            min="1"
            max="65535"
            className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            required
          />
        </div>

        {/* Host */}
        <div className="space-y-1.5">
          <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
            {t("transports.add.host")}
          </label>
          <input
            type="text"
            value={host}
            onChange={(e) => setHost(e.target.value)}
            className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            required
          />
        </div>
      </div>

      <div className="flex items-center justify-end gap-3 pt-6 mt-6 border-t border-gray-200 dark:border-gray-700">
        <Button
          type="button"
          variant="outline"
          onClick={onCancel}
          className="px-4 py-2"
        >
          {t("transports.add.cancel")}
        </Button>
        <Button
          type="submit"
          variant="primary"
          disabled={filteredTypes.length === 0}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white disabled:bg-gray-400"
        >
          {t("transports.add.submit")}
        </Button>
      </div>
    </form>
  )
}

export default TransportConfigPage
