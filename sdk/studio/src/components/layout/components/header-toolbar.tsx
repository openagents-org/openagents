import {
  Coffee,
  MessageSquareCode,
  Pin,
  ClipboardList,
  Plus,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLayout } from "./context";

export function HeaderToolbar() {
  const { isMobile } = useLayout();

  return (
    <nav className="flex items-center gap-2.5">
      <Button mode="icon" variant="outline"><Coffee /></Button>
      <Button mode="icon" variant="outline"><MessageSquareCode /></Button>
      <Button mode="icon" variant="outline"><Pin /></Button>

      {isMobile ? (
        <>
          <Button variant="outline" mode="icon"><ClipboardList /></Button>
          <Button variant="mono" mode="icon"><Plus /></Button>
        </>
      ) : (
        <>
          <Button variant="outline"><ClipboardList /> Reports</Button>
          <Button variant="mono"><Plus /> Add</Button>
        </>
      )}
    </nav>
  );
}
