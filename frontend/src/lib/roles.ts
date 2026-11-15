import type { Role } from "../stores/role";

// Shared by the header's segmented control and the first-visit role
// picker, so the label/home-route for each role lives in exactly one
// place.
export const roleHome: Record<Role, string> = {
  customer: "/shop",
  picker: "/picker",
  manager: "/ops",
};

export const roles: { role: Role; label: string; shortLabel: string; blurb: string }[] = [
  { role: "customer", label: "Customer", shortLabel: "Customer", blurb: "Browse the shop and track an order" },
  { role: "picker", label: "Picker", shortLabel: "Picker", blurb: "Pick items for incoming orders" },
  { role: "manager", label: "Store Manager", shortLabel: "Manager", blurb: "Watch the live order queue" },
];
