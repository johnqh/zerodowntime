import { useAuth } from "../context/AuthContext";

export const Login = () => {
  const { signIn } = useAuth();

  return (
    <div className="mx-auto grid min-h-screen max-w-6xl grid-cols-1 content-center gap-10 px-6 md:grid-cols-[2fr_1fr]">
      <div>
        <h1 className="text-display font-bold leading-none tracking-title">
          Craigs
          <span className="text-accent">Notice</span>
        </h1>
        <p className="mt-6 max-w-xl text-lede text-ink-muted">
          Tell it what you are hunting for. It watches Craigslist on its own and
          notifies you the moment a genuinely good deal appears.
        </p>

        <dl className="rule-double mt-10 grid max-w-xl grid-cols-3 border-b-0 border-t-[3px] border-double border-rule pt-5">
          {[
            ["413", "Craigslist cities"],
            ["46", "Categories"],
            ["Always", "Watching"],
          ].map(([figure, label]) => (
            <div key={label}>
              <dt className="figure text-2xl font-bold">{figure}</dt>
              <dd className="eyebrow mt-1 text-ink-faint">{label}</dd>
            </div>
          ))}
        </dl>
      </div>

      <div className="self-end">
        <button
          type="button"
          onClick={() => void signIn()}
          className="eyebrow w-full border border-rule bg-ink px-6 py-4 text-paper shadow-card hover:bg-accent"
        >
          Sign in with Google
        </button>
      </div>
    </div>
  );
};

export default Login;
