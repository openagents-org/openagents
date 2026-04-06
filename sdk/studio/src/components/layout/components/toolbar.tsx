import { ReactNode } from "react";

function Toolbar({ children }: { children?: ReactNode }) {
  return (
    <div className="flex flex-col grow gap-5 mb-4 lg:mb-6">
      {children}
    </div>
  );
}

function ToolbarActions({ children }: { children?: ReactNode }) {
  return <div className="flex items-center gap-2.5">{children}</div>;
}

function ToolbarHeading ({ children }: { children: ReactNode }) {
  return <div className="flex flex-col flex-wrap gap-2.5 lg:gap-4">{children}</div>;
}

function ToolbarPageTitle ({ children }: { children: ReactNode }) {
  return (
    <h1 className="text-xl font-medium leading-none text-foreground">
      {children}
    </h1>
  );
};

function ToolbarWrapper({ children }: { children?: ReactNode }) {
  return <div className="flex items-center flex-wrap justify-between gap-2.5">{children}</div>;
}

export {
  Toolbar,
  ToolbarActions,
  ToolbarHeading,
  ToolbarPageTitle,
  ToolbarWrapper
};
