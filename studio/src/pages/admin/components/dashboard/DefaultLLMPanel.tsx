import React from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/layout/ui/button";
import { Badge } from "@/components/layout/ui/badge";
import { Card, CardContent, CardHeader, CardHeading, CardTitle, CardToolbar } from "@/components/layout/ui/card";
import { Cpu, Pencil } from "lucide-react";

interface DefaultModelConfig {
  provider: string;
  model_name: string;
  api_key?: string;
  base_url?: string;
}

interface DefaultLLMPanelProps {
  defaultModelConfig: DefaultModelConfig | null;
}

const DefaultLLMPanel: React.FC<DefaultLLMPanelProps> = ({ defaultModelConfig }) => {
  const { t } = useTranslation("admin");
  const navigate = useNavigate();

  return (
    <Card variant="default">
      <CardHeader>
        <CardHeading>
          <CardTitle className="flex items-center gap-2">
            <Cpu className="w-4 h-4 text-gray-500 dark:text-gray-400" />
            {t("dashboard.defaultLLM.title")}
          </CardTitle>
        </CardHeading>
        <CardToolbar>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate("/admin/default-models")}
          >
            <Pencil className="w-3 h-3 mr-1" />
            {t("dashboard.defaultLLM.configure")}
          </Button>
        </CardToolbar>
      </CardHeader>
      <CardContent>
        {defaultModelConfig && defaultModelConfig.provider && defaultModelConfig.model_name ? (
          <div className="space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                {defaultModelConfig.provider}
              </span>
              <span className="text-gray-400 dark:text-gray-500">/</span>
              <span className="text-sm font-semibold text-indigo-600 dark:text-indigo-400">
                {defaultModelConfig.model_name}
              </span>
            </div>
            {defaultModelConfig.api_key && (
              <Badge
                variant="secondary"
                appearance="light"
                size="sm"
                className="bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400"
              >
                {t("dashboard.defaultLLM.apiKeySet")}
              </Badge>
            )}
          </div>
        ) : (
          <div className="text-sm text-gray-500 dark:text-gray-400 italic">
            {t("dashboard.defaultLLM.notConfigured")}
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default DefaultLLMPanel;
