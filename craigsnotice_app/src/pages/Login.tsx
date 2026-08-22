import { useAuth } from "../context/AuthContext";

export const Login = () => {
  const { signIn } = useAuth();

  return (
    <div className="flex min-h-[70vh] flex-col items-center justify-center gap-6 px-6 text-center">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight text-slate-900">
          CraigsNotice
        </h1>
        <p className="mt-2 max-w-md text-slate-600">
          Tell us what you are hunting for. We watch Craigslist and push you a
          notification the moment a genuinely good deal shows up.
        </p>
      </div>

      <button
        type="button"
        onClick={() => void signIn()}
        className="rounded-lg bg-slate-900 px-6 py-3 font-medium text-white transition hover:bg-slate-700"
      >
        Sign in with Google
      </button>
    </div>
  );
};

export default Login;
