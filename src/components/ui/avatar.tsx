import * as React from "react";
import { cn, initials } from "../../lib/utils";

interface AvatarProps extends React.HTMLAttributes<HTMLDivElement> {
  name: string;
  color?: string;
  size?: "sm" | "md" | "lg";
}

const sizeClasses = {
  sm: "h-6 w-6 text-[10px]",
  md: "h-8 w-8 text-xs",
  lg: "h-10 w-10 text-sm",
};

const Avatar = React.forwardRef<HTMLDivElement, AvatarProps>(
  ({ className, name, color, size = "md", ...props }, ref) => {
    const bg = color || "#6b7a8d";
    return (
      <div
        ref={ref}
        className={cn(
          "inline-flex items-center justify-center rounded-md font-semibold text-white shrink-0",
          sizeClasses[size],
          className
        )}
        style={{ backgroundColor: bg }}
        title={name}
        {...props}
      >
        {initials(name)}
      </div>
    );
  }
);
Avatar.displayName = "Avatar";

function AvatarStack({
  people,
  limit = 3,
  size = "md",
}: {
  people: { name: string; color?: string }[];
  limit?: number;
  size?: "sm" | "md" | "lg";
}) {
  const shown = people.slice(0, limit);
  const remaining = people.length - limit;
  return (
    <div className="flex -space-x-2">
      {shown.map((person, i) => (
        <Avatar
          key={i}
          name={person.name}
          color={person.color}
          size={size}
          className="ring-2 ring-white"
        />
      ))}
      {remaining > 0 && (
        <div
          className={cn(
            "inline-flex items-center justify-center rounded-md bg-slate-100 text-slate-600 font-medium ring-2 ring-white shrink-0",
            sizeClasses[size]
          )}
        >
          +{remaining}
        </div>
      )}
    </div>
  );
}

export { Avatar, AvatarStack };
