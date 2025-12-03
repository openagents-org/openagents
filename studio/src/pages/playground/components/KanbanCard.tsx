import React from "react";
import { KanbanCard as KanbanCardType } from "@/stores/playgroundStore";

interface KanbanCardProps {
  card: KanbanCardType;
  onSelect: (cardId: string) => void;
  onDragStart: (e: React.DragEvent, cardId: string) => void;
  isSelected: boolean;
}

const priorityColors: Record<string, string> = {
  low: "bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300",
  medium: "bg-blue-100 text-blue-600 dark:bg-blue-900 dark:text-blue-300",
  high: "bg-orange-100 text-orange-600 dark:bg-orange-900 dark:text-orange-300",
  urgent: "bg-red-100 text-red-600 dark:bg-red-900 dark:text-red-300",
};

const labelColors = [
  "bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300",
  "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300",
  "bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300",
  "bg-pink-100 text-pink-700 dark:bg-pink-900 dark:text-pink-300",
  "bg-indigo-100 text-indigo-700 dark:bg-indigo-900 dark:text-indigo-300",
];

const KanbanCard: React.FC<KanbanCardProps> = ({
  card,
  onSelect,
  onDragStart,
  isSelected,
}) => {
  return (
    <div
      draggable
      onDragStart={(e) => onDragStart(e, card.card_id)}
      onClick={() => onSelect(card.card_id)}
      className={`
        p-3 bg-white dark:bg-gray-800 rounded-lg shadow-sm border-2 cursor-pointer
        transition-all duration-150 hover:shadow-md
        ${
          isSelected
            ? "border-blue-500 ring-2 ring-blue-200 dark:ring-blue-800"
            : "border-transparent hover:border-gray-200 dark:hover:border-gray-600"
        }
      `}
    >
      {/* Labels */}
      {card.labels.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-2">
          {card.labels.slice(0, 3).map((label, idx) => (
            <span
              key={label}
              className={`text-xs px-2 py-0.5 rounded-full ${
                labelColors[idx % labelColors.length]
              }`}
            >
              {label}
            </span>
          ))}
          {card.labels.length > 3 && (
            <span className="text-xs text-gray-500">
              +{card.labels.length - 3}
            </span>
          )}
        </div>
      )}

      {/* Title */}
      <h4 className="font-medium text-gray-900 dark:text-white text-sm mb-1">
        {card.title}
      </h4>

      {/* Description Preview */}
      {card.description && (
        <p className="text-xs text-gray-500 dark:text-gray-400 line-clamp-2 mb-2">
          {card.description}
        </p>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between mt-2">
        {/* Priority */}
        <span
          className={`text-xs px-2 py-0.5 rounded ${
            priorityColors[card.priority] || priorityColors.medium
          }`}
        >
          {card.priority}
        </span>

        {/* Assignee */}
        {card.assignee_id && (
          <div className="flex items-center">
            <div className="w-6 h-6 rounded-full bg-gradient-to-br from-blue-400 to-purple-500 flex items-center justify-center">
              <span className="text-white text-xs font-medium">
                {card.assignee_id.charAt(0).toUpperCase()}
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default KanbanCard;
