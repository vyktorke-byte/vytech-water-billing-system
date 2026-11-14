import firebaseRules from '@firebase/eslint-plugin-security-rules';

export default [
  {
    ignores: ['dist/**/*'],
  },
  firebaseRules.configs['flat/recommended'],
  {
    files: ['firestore.rules'],
    rules: {
      '@firebase/security-rules/no-open-reads': 'error',
      '@firebase/security-rules/no-open-writes': 'error',
      '@firebase/security-rules/no-redundant-matches': 'error',
    },
  },
];
