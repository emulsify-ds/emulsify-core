/**
 * @file Storybook compiled dist CSS side-effect loader.
 */

// Import matching CSS for Vite side effects so CSS HMR stays on the native path.
import.meta.glob('../../../../dist/**/*.css', { eager: true });
