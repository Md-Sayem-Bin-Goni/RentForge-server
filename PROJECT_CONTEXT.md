# Project: RentForge (Equipment Rental Platform)
- **Theme:** Modern Emerald & Charcoal
  - Light Mode: Bg `#F9FAFB`, Card `#FFFFFF`, Nav `#111827`, Primary `#059669`, Hover `#047857`, Text `#111827`
  - Dark Mode: Bg `#090D16`, Card `#111827`, Nav `#030712`, Primary `#10B981`, Text `#F9FAFB`
- **Roles:** `customer`, `owner`, `admin` (default: `customer`).
- **Strict Rules:**
  - Do NOT add Email Verification or Forgot Password.
  - Handle auth loading states (`isPending` / `isLoading`) properly so reloading any private route NEVER redirects logged-in users to `/login`.
  - Keep all equipment cards uniform in height and width; use the new X logo instead of the old Twitter bird in the footer.
  