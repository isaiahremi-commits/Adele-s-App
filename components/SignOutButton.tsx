// Plain form POST to the sign-out route — no JS required; the route clears the
// session cookie and redirects to /login.
export default function SignOutButton() {
  return (
    <form action="/api/auth/signout" method="post">
      <button
        type="submit"
        className="text-xs w-full text-left"
        style={{ color: "var(--muted)", background: "none", border: "none", cursor: "pointer", padding: 0 }}
      >
        Sign out
      </button>
    </form>
  );
}
