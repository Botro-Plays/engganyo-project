import { ListTodo } from 'lucide-react';

export default function TasksPage() {
  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-white">Tasks</h1>
        <p className="text-zinc-400 text-sm mt-1">Browse and complete tasks to earn credits.</p>
      </div>
      <div className="card-glass rounded-2xl p-16 flex flex-col items-center justify-center text-center">
        <ListTodo className="w-12 h-12 text-zinc-600 mb-4" />
        <h2 className="text-lg font-semibold text-white mb-2">Task marketplace coming soon</h2>
        <p className="text-zinc-500 text-sm max-w-sm">
          The task system is being built in Phase 5. You&apos;ll be able to browse YouTube, TikTok,
          Instagram tasks and earn credits for completing them.
        </p>
      </div>
    </div>
  );
}
