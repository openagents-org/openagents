import React from "react";
import { CollaborationUser } from "@/services/collaborationService";

interface UserCursorProps {
  user: CollaborationUser;
  position: {
    line: number;
    column: number;
  };
  theme: "light" | "dark";
  isVisible?: boolean;
}

const UserCursor: React.FC<UserCursorProps> = ({
  user,
  position,
  theme,
  isVisible = true,
}) => {
  if (!isVisible || !user.cursor) {
    return null;
  }

  return (
    <>
      {/* Cursor line */}
      <div
        className="absolute pointer-events-none z-50"
        style={{
          borderLeft: `2px solid ${user.color}`,
          height: "1.2em",
          opacity: 0.8,
          animation: "cursor-blink 1s infinite",
        }}
      />

      {/* User label */}
      <div
        className="absolute pointer-events-none z-50 transform -translate-y-full"
        style={{
          backgroundColor: user.color,
          color: "#ffffff",
          fontSize: "11px",
          fontWeight: "500",
          padding: "2px 6px",
          borderRadius: "3px",
          whiteSpace: "nowrap",
          marginTop: "-2px",
          boxShadow: "0 2px 4px rgba(0, 0, 0, 0.1)",
        }}
      >
        {user.name}
      </div>

      {/* Selection highlight (if there's a selection) */}
      {user.cursor && (
        <div
          className="absolute pointer-events-none z-40"
          style={{
            backgroundColor: user.color,
            opacity: 0.2,
            borderRadius: "2px",
          }}
        />
      )}

      <style>
        {`
          @keyframes cursor-blink {
            0%, 50% {
              opacity: 0.8;
            }
            51%, 100% {
              opacity: 0.3;
            }
          }
        `}
      </style>
    </>
  );
};

export default UserCursor;
