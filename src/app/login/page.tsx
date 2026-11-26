import { redirect } from "next/navigation";

/**
 * Customers sign in and trade in the Nexora app; the website has no customer sign-in.
 * Staff sign in at /admin/login. Old links to /login land on the app download section.
 */
export default function LoginPage() {
  redirect("/#get-app");
}