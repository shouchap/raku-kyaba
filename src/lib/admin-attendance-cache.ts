import { revalidatePath } from "next/cache";

export function revalidateAdminAttendancePages() {
  revalidatePath("/admin/view", "page");
  revalidatePath("/admin/report", "page");
}
