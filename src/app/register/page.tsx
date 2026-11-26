import { redirect } from "next/navigation";

/** Accounts are created in the Nexora app. Old links to /register land on the app download section. */
export default function RegisterPage() {
  redirect("/#get-app");
}