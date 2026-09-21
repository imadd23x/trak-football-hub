import { forwardRef, useEffect, useId, useState, type ComponentProps } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { Input } from './input'
import { cn } from '@/lib/utils'

interface PasswordInputProps extends Omit<ComponentProps<'input'>, 'type'> {
  label: string
}

// Keep the native input's value, autocomplete and validation behavior. Each
// field has its own reveal control; clicking it must never submit its form.
export const PasswordInput = forwardRef<HTMLInputElement, PasswordInputProps>(
  ({ label, id, className, value, disabled, ...props }, ref) => {
    const generatedId = useId()
    const inputId = id ?? generatedId
    const [visible, setVisible] = useState(false)
    // Clearing a controlled form should also clear its reveal state.
    useEffect(() => { if (value === '') setVisible(false) }, [value])
    return <div className="relative">
      <Input {...props} ref={ref} id={inputId} aria-label={label}
        type={visible ? 'text' : 'password'} value={value} disabled={disabled}
        className={cn('h-11 pr-12', className)} />
      <button type="button" disabled={disabled} aria-controls={inputId} aria-pressed={visible}
        aria-label={`${visible ? 'Hide' : 'Show'} ${label.toLowerCase()}`}
        onClick={() => setVisible(current => !current)}
        className="absolute bottom-0 right-0 flex h-11 w-11 items-center justify-center rounded-md text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50">
        {visible ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}
      </button>
    </div>
  },
)
PasswordInput.displayName = 'PasswordInput'
