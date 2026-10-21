'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

export function NavLinks({ links }: { links: Array<{ href: string; label: string }> }) {
  const pathname = usePathname()
  return (
    <nav className="flex items-center gap-1 rounded-full bg-muted p-1 text-sm">
      {links.map((link) => {
        const active = pathname === link.href || pathname.startsWith(`${link.href}/`)
        return (
          <Link
            key={link.href}
            href={link.href}
            aria-current={active ? 'page' : undefined}
            className={`rounded-full px-3.5 py-1.5 font-medium transition-colors ${
              active ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {link.label}
          </Link>
        )
      })}
    </nav>
  )
}
