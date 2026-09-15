import * as React from "react";
import { cn } from "@/lib/utils";
import { control } from "@/components/ui/control";

export interface InputProps
  extends React.InputHTMLAttributes<HTMLInputElement> {}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={control({
          className: cn(
            "flex w-full file:border-0 file:bg-transparent file:text-body file:font-medium",
            className,
          ),
        })}
        ref={ref}
        {...props}
      />
    );
  }
);
Input.displayName = "Input";

export { Input };
