import React, { useState, useEffect, useContext, useMemo } from "react"
import { useNavigate } from "react-router-dom"
import { useTranslation } from "react-i18next"
import { ColumnDef } from "@tanstack/react-table"
import { useForumStore, ForumTopic } from "@/stores/forumStore"
import ForumCreateModal from "./components/ForumCreateModal"
import { OpenAgentsContext } from "@/context/OpenAgentsProvider"
import { DataTable } from "@/components/layout/ui/data-table"
import { Button } from "@/components/layout/ui/button"
import { Badge } from "@/components/layout/ui/badge"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardHeading,
  CardTitle,
  CardToolbar,
} from "@/components/layout/ui/card"
import {
  Plus,
  RefreshCw,
  MessageSquare,
  ThumbsUp,
  ThumbsDown,
  Eye,
  AlertCircle,
} from "lucide-react"

const ForumTopicList: React.FC = () => {
  const { t } = useTranslation("forum")
  const context = useContext(OpenAgentsContext)
  const openAgentsService = context?.connector
  const [showCreateModal, setShowCreateModal] = useState(false)
  const isConnected = context?.isConnected
  const navigate = useNavigate()

  const {
    topics,
    topicsLoading,
    topicsError,
    setConnection,
    setGroupsData,
    setAgentId,
    loadTopics,
    getPopularTopics,
    setupEventListeners,
    cleanupEventListeners,
  } = useForumStore()

  // Get popular topics
  const popularTopics = useMemo(() => {
    return getPopularTopics()
  }, [getPopularTopics])

  // Set connection
  useEffect(() => {
    if (openAgentsService) {
      setConnection(openAgentsService)
    }
  }, [openAgentsService, setConnection])

  // Initialize permission data
  useEffect(() => {
    const initializePermissions = async () => {
      if (!openAgentsService) return

      try {
        // Get current agent ID
        const agentId = openAgentsService.getAgentId()
        if (agentId) {
          setAgentId(agentId)
        }

        // Get groups data
        const healthData = await openAgentsService.getNetworkHealth()
        if (healthData && healthData.groups) {
          setGroupsData(healthData.groups)
        }
      } catch (error) {
        console.error(
          "ForumTopicList: Failed to initialize permissions:",
          error
        )
      }
    }

    initializePermissions()
  }, [openAgentsService, setGroupsData, setAgentId])

  // Load topics (wait for connection to be established)
  useEffect(() => {
    if (openAgentsService && isConnected) {
      loadTopics()
    }
  }, [openAgentsService, isConnected, loadTopics])

  // Set up forum event listeners
  useEffect(() => {
    if (openAgentsService) {
      setupEventListeners()

      return () => {
        cleanupEventListeners()
      }
    }
  }, [openAgentsService, setupEventListeners, cleanupEventListeners])

  // Format timestamp
  const formatTime = (timestamp: number) => {
    const date = new Date(timestamp)
    return date.toLocaleString("zh-CN", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    })
  }

  // Define columns for DataTable
  const columns: ColumnDef<ForumTopic>[] = useMemo(
    () => [
      {
        accessorKey: "title",
        header: t("table.title"),
        cell: ({ row }) => (
          <div className="max-w-[300px]">
            <span className="font-medium text-gray-900 dark:text-gray-100 line-clamp-2">
              {row.original.title}
            </span>
          </div>
        ),
      },
      {
        accessorKey: "owner_id",
        header: t("table.author"),
        cell: ({ row }) => (
          <span className="text-sm text-gray-600 dark:text-gray-400">
            {row.original.owner_id}
          </span>
        ),
      },
      {
        accessorKey: "timestamp",
        header: t("table.time"),
        cell: ({ row }) => (
          <span className="text-sm text-gray-500 dark:text-gray-400">
            {formatTime(row.original.timestamp)}
          </span>
        ),
      },
      {
        id: "votes",
        header: t("table.votes"),
        cell: ({ row }) => {
          const topic = row.original
          return (
            <div className="flex items-center gap-3">
              <span className="inline-flex items-center text-green-600 dark:text-green-400">
                <ThumbsUp className="w-3.5 h-3.5 mr-1" />
                {topic.upvotes}
              </span>
              <span className="inline-flex items-center text-red-600 dark:text-red-400">
                <ThumbsDown className="w-3.5 h-3.5 mr-1" />
                {topic.downvotes}
              </span>
            </div>
          )
        },
      },
      {
        accessorKey: "comment_count",
        header: t("table.comments"),
        cell: ({ row }) => (
          <Badge variant="secondary" appearance="light" size="sm">
            <MessageSquare className="w-3 h-3 mr-1" />
            {row.original.comment_count}
          </Badge>
        ),
      },
      {
        id: "actions",
        header: () => <div className="text-center">{t("table.actions")}</div>,
        cell: ({ row }) => (
          <div className="text-center">
            <Button
              variant="ghost"
              size="sm"
              onClick={(e) => {
                e.stopPropagation()
                navigate(`/forum/${row.original.topic_id}`)
              }}
            >
              <Eye className="w-4 h-4 mr-1" />
              {t("table.view")}
            </Button>
          </div>
        ),
      },
    ],
    [t, navigate]
  )

  // Error state
  if (topicsError) {
    return (
      <div className="h-full flex flex-col overflow-hidden bg-white dark:bg-gray-800">
        <div className="p-6">
          <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
            <div className="flex items-center">
              <AlertCircle className="h-5 w-5 text-red-400" />
              <p className="ml-3 text-sm text-red-800 dark:text-red-200">
                {topicsError}
              </p>
            </div>
            <Button
              onClick={loadTopics}
              variant="outline"
              size="md"
              className="mt-3"
            >
              {t("list.tryAgain")}
            </Button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col overflow-hidden bg-white dark:bg-gray-800">
      <Card variant="default" className="h-full flex flex-col border-0 rounded-none shadow-none">
        <CardHeader>
          <CardHeading>
            <CardTitle>{t("list.title")}</CardTitle>
            <CardDescription>
              {t("list.topicsAvailable", { count: topics.length })}
            </CardDescription>
          </CardHeading>
          <CardToolbar>
            <Button
              variant="primary"
              onClick={() => setShowCreateModal(true)}
              size="md"
            >
              <Plus className="w-4 h-4 mr-1.5" />
              {t("list.newTopic")}
            </Button>
            <Button
              onClick={loadTopics}
              disabled={topicsLoading}
              variant="outline"
              size="md"
            >
              <RefreshCw
                className={`w-4 h-4 mr-1.5 ${
                  topicsLoading ? "animate-spin" : ""
                }`}
              />
              {t("list.refresh")}
            </Button>
          </CardToolbar>
        </CardHeader>
        <CardContent className="flex-1 overflow-hidden flex flex-col gap-4">
          {/* Popular Topics Section */}
          {popularTopics.length > 0 && (
            <Card variant="default" className="border border-gray-200 dark:border-gray-700">
              <CardHeader>
                <CardHeading>
                  <CardTitle className="text-base">
                    {t("sidebar.popular10Topics")}
                  </CardTitle>
                </CardHeading>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-8 gap-2">
                  {popularTopics.map((topic) => {
                    const totalVotes = topic.upvotes + topic.downvotes
                    return (
                      <button
                        key={topic.topic_id}
                        onClick={() => navigate(`/forum/${topic.topic_id}`)}
                        className="text-left p-2 rounded-md border bg-white dark:bg-zinc-950 border-gray-200 dark:border-gray-600 hover:border-blue-500 dark:hover:border-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-all duration-200 group"
                      >
                        <div className="flex items-start justify-between gap-1.5">
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-medium text-gray-900 dark:text-gray-100 line-clamp-2 group-hover:text-blue-600 dark:group-hover:text-blue-400">
                              {topic.title}
                            </p>
                            <div className="flex items-center gap-2 mt-1">
                              <span className="inline-flex items-center text-xs text-gray-500 dark:text-gray-400">
                                <MessageSquare className="w-3 h-3 mr-0.5" />
                                {topic.comment_count}
                              </span>
                              <span className="inline-flex items-center text-xs text-orange-600 dark:text-orange-400">
                                🔥 {totalVotes}
                              </span>
                            </div>
                          </div>
                        </div>
                      </button>
                    )
                  })}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Topics DataTable */}
          <div className="flex-1 overflow-hidden">
            <DataTable
              columns={columns}
              data={topics}
              loading={topicsLoading && topics.length === 0}
              searchable={true}
              searchPlaceholder={t("list.searchPlaceholder")}
              searchColumn="title"
              pagination={true}
              pageSize={10}
              emptyMessage={t("list.noTopics")}
              emptyIcon={<MessageSquare className="w-12 h-12 text-gray-400" />}
              onRowClick={(row) => navigate(`/forum/${row.topic_id}`)}
            />
          </div>
        </CardContent>
      </Card>

      {/* Create topic modal */}
      <ForumCreateModal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
      />
    </div>
  )
}

export default ForumTopicList
