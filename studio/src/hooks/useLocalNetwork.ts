import { useEffect, useState } from "react";
import { detectLocalNetwork } from "@/services/networkService";
import { NetworkConnection } from "@/types/connection";

export default function useLocalNetwork() {
  const [localNetwork, setLocalNetwork] = useState<NetworkConnection | null>(
    null
  );
  const [isLoadingLocal, setIsLoadingLocal] = useState(true);

  useEffect(() => {
    const checkLocal = async () => {
      setIsLoadingLocal(true);
      try {
        const local = await detectLocalNetwork();
        setLocalNetwork(local);
      } catch (error) {
        console.error("Error detecting local network:", error);
      } finally {
        setIsLoadingLocal(false);
      }
    };

    checkLocal();
  }, []);

  return { localNetwork, isLoadingLocal };
}
