// TEMPORARY WO-124F QA harness — removed after evidence capture.
import { useEffect } from "react";
import { showErrorToast } from "@/lib/errorToast";
import { isStaleClientError } from "@/lib/errors";
import { ToastAction } from "@/components/ui/toast";

export default function QaStaleToast() {
  useEffect(() => {
    const e = { code: "22023", message: "Choose what this Meetup is about." };
    showErrorToast(e, {
      surface: "host_create",
      action: isStaleClientError(e) ? (
        <ToastAction altText="Reload VeggieMeet to get the latest version">Reload</ToastAction>
      ) : undefined,
    });
  }, []);
  return <div className="p-6">WO-124F QA harness</div>;
}
