import React from "react"
import { useNavigate } from "react-router-dom"
import { InterviewTopic } from "@/stores/interviewStore"
import MarkdownRenderer from "@/components/common/MarkdownRenderer"
import { formatDateTime } from "@/utils/utils"

interface InterviewTopicItemProps {
  topic: InterviewTopic
  onClick?: (topicId: string) => void
}

const InterviewTopicItem: React.FC<InterviewTopicItemProps> = React.memo(
  ({ topic, onClick }) => {
    const navigate = useNavigate()

    const handleClick = () => {
      if (onClick) {
        onClick(topic.topic_id)
      } else {
        console.log(
          "InterviewTopicItem: Navigating to topic:",
          topic.topic_id,
          "URL:",
          `/interview/${topic.topic_id}`
        )
        navigate(`/interview/${topic.topic_id}`)
      }
    }

    const timeAgo = formatDateTime(topic.timestamp * 1000)

    return (
      <div
        onClick={handleClick}
        className="p-4 rounded-lg border cursor-pointer transition-all hover:shadow-lg bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-750 hover:border-gray-300 dark:hover:border-gray-600"
      >
        {/* Interview badge and title */}
        <div className="flex items-start space-x-2 mb-2">
          <div className="flex-shrink-0 mt-1">
            <svg
              className="w-5 h-5 text-blue-500"
              fill="currentColor"
              viewBox="0 0 20 20"
            >
              <path
                fillRule="evenodd"
                d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4zm2 6a1 1 0 011-1h6a1 1 0 110 2H7a1 1 0 01-1-1zm1 3a1 1 0 100 2h6a1 1 0 100-2H7z"
                clipRule="evenodd"
              />
            </svg>
          </div>
          <div className="flex-1">
            <h3 className="text-lg font-semibold line-clamp-2 text-gray-900 dark:text-gray-100">
              {topic.title}
            </h3>
          </div>
        </div>

        {/* Content preview */}
        <div className="text-sm line-clamp-3 ml-7">
          <MarkdownRenderer
            content={topic.content}
            truncate={true}
            maxLength={200}
            className="text-gray-600 dark:text-gray-400"
          />
        </div>

        {/* Meta information */}
        <div className="flex items-center justify-between mt-3 ml-7">
          <div className="flex items-center space-x-4">
            {/* Resume indicator */}
            <div className="flex items-center space-x-1">
              <svg
                className="w-4 h-4 text-red-500"
                fill="currentColor"
                viewBox="0 0 20 20"
              >
                <path
                  fillRule="evenodd"
                  d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4zm2 6a1 1 0 011-1h6a1 1 0 110 2H7a1 1 0 01-1-1zm1 3a1 1 0 100 2h6a1 1 0 100-2H7z"
                  clipRule="evenodd"
                />
              </svg>
              <span className="text-xs text-gray-500 dark:text-gray-400">
                Resume
              </span>
            </div>

            {/* Comments count */}
            <div className="flex items-center space-x-1">
              <svg
                className="w-4 h-4 text-gray-500 dark:text-gray-400"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
                />
              </svg>
              <span className="text-sm text-gray-500 dark:text-gray-400">
                {topic.comment_count}
              </span>
            </div>

            {/* Private indicator */}
            <div className="flex items-center space-x-1">
              <svg
                className="w-4 h-4 text-gray-400"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
                />
              </svg>
              <span className="text-xs text-gray-400 dark:text-gray-500">
                Private
              </span>
            </div>
          </div>

          {/* Author and time */}
          <div className="text-xs text-gray-400 dark:text-gray-500">
            by {topic.owner_id} • {timeAgo}
          </div>
        </div>
      </div>
    )
  }
)

InterviewTopicItem.displayName = "InterviewTopicItem"

export default InterviewTopicItem
