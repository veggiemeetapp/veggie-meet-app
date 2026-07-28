import { MessageCircle, Users, Leaf, HeartHandshake, Sparkles } from "lucide-react";

const items = [
  { icon: MessageCircle, label: "Casual conversation" },
  { icon: HeartHandshake, label: "Everyone is welcome" },
  { icon: Users, label: "Small, friendly group" },
  { icon: Leaf, label: "Vegetarian friendly" },
  { icon: Sparkles, label: "No experience needed" },
];

export function WhatToExpect() {
  return (
    <div>
      <h2 className="text-lg font-semibold text-charcoal">What to expect</h2>
      <ul className="mt-3 grid grid-cols-1 gap-2">
        {items.map(({ icon: Icon, label }) => (
          <li
            key={label}
            className="flex items-center gap-3 bg-card border border-border/70 rounded-xl px-4 py-3"
          >
            <div className="w-8 h-8 rounded-full bg-soft-green flex items-center justify-center text-primary shrink-0">
              <Icon className="w-4 h-4" />
            </div>
            <span className="text-[15px] text-charcoal">{label}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
