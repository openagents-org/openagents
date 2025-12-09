import React, { useState } from "react";
import { KanbanColumn as KanbanColumnType, KanbanCard as KanbanCardType } from "@/stores/playgroundStore";
import KanbanCard from "./KanbanCard";

interface KanbanColumnProps {
  column: KanbanColumnType;
  cards: KanbanCardType[];
  selectedCardId: string | null;
  onSelectCard: (cardId: string) => void;
  onMoveCard: (cardId: string, columnId: string) => void;
  onAddCard: (columnId: string) => void;
}

const KanbanColumn: React.FC<KanbanColumnProps> = ({
  column,
  cards,
  selectedCardId,
  onSelectCard,
  onMoveCard,
  onAddCard,
}) => {
  const [isDragOver, setIsDragOver] = useState(false);
  const [draggedCardId, setDraggedCardId] = useState<string | null>(null);

  const handleDragStart = (e: React.DragEvent, cardId: string) => {
    e.dataTransfer.setData("cardId", cardId);
    setDraggedCardId(cardId);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = () => {
    setIsDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const cardId = e.dataTransfer.getData("cardId");
    if (cardId) {
      onMoveCard(cardId, column.column_id);
    }
    setDraggedCardId(null);
  };

  const isAtWipLimit = column.wip_limit !== null && cards.length >= column.wip_limit;

  return (
    <div
      className={`
        flex-shrink-0 w-72 bg-gray-50 dark:bg-gray-900 rounded-lg flex flex-col
        ${isDragOver ? "ring-2 ring-blue-400 ring-opacity-50" : ""}
      `}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Column Header */}
      <div className="p-3 border-b border-gray-200 dark:border-gray-700">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold text-gray-900 dark:text-white">
              {column.name}
            </h3>
            <span className="text-xs bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300 px-2 py-0.5 rounded-full">
              {cards.length}
              {column.wip_limit !== null && `/${column.wip_limit}`}
            </span>
          </div>
          <button
            onClick={() => onAddCard(column.column_id)}
            disabled={isAtWipLimit}
            className={`
              p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors
              ${isAtWipLimit ? "opacity-50 cursor-not-allowed" : ""}
            `}
            title={isAtWipLimit ? "WIP limit reached" : "Add card"}
          >
            <svg
              className="w-5 h-5 text-gray-500 dark:text-gray-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 4v16m8-8H4"
              />
            </svg>
          </button>
        </div>
        {isAtWipLimit && (
          <p className="text-xs text-orange-500 mt-1">WIP limit reached</p>
        )}
      </div>

      {/* Cards */}
      <div className="flex-1 p-2 space-y-2 overflow-y-auto min-h-[100px]">
        {cards.length === 0 ? (
          <div className="text-center py-8 text-gray-400 dark:text-gray-600 text-sm">
            No cards
          </div>
        ) : (
          cards.map((card) => (
            <KanbanCard
              key={card.card_id}
              card={card}
              onSelect={onSelectCard}
              onDragStart={handleDragStart}
              isSelected={selectedCardId === card.card_id}
            />
          ))
        )}
      </div>
    </div>
  );
};

export default KanbanColumn;
