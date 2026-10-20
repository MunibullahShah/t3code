import { usePrimaryEnvironment } from "../state/environments";
import { usePrimarySettings, useUpdatePrimarySettings } from "./useSettings";

/**
 * Keep awake belongs to the machine running the agents, so it reads and
 * writes the primary environment's server setting.
 */
export function useKeepAwake() {
  const environment = usePrimaryEnvironment();
  const supported = environment?.serverConfig?.keepAwakeSupported === true;
  const enabled = usePrimarySettings((settings) => settings.keepAwake);
  const updateSettings = useUpdatePrimarySettings();
  const setEnabled = (next: boolean) => {
    void updateSettings({ keepAwake: next });
  };
  return { supported, enabled, setEnabled, toggle: () => setEnabled(!enabled) };
}
