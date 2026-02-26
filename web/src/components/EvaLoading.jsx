/**
 * Loading state: EVA logo with spinning wheel underneath.
 */
import EvaLogo from './EvaLogo';

export default function EvaLoading({ className = '', size = 'lg' }) {
  const logoSize = size === 'sm' ? 'sm' : size === 'xs' ? 'xs' : 'lg';
  const spinnerClass = size === 'sm' ? 'w-6 h-6 border-2' : size === 'xs' ? 'w-4 h-4 border' : 'w-10 h-10 border-2';
  const gapClass = size === 'sm' ? 'gap-3' : size === 'xs' ? 'gap-2' : 'gap-6';

  return (
    <div className={`flex flex-col items-center justify-center ${gapClass} ${className}`}>
      <EvaLogo size={logoSize} variant="icon" />
      <div className={`${spinnerClass} rounded-full border-red-500 dark:border-red-400 border-t-transparent animate-spin`} />
    </div>
  );
}
