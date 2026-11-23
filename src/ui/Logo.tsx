/** The Cleared mark, in the ink that suits the current theme (styles.css shows one). */
export function Logo({ size, style }: { size: number; style?: React.CSSProperties }) {
  return (
    <>
      <img className="logo logo-light" src="/icon/128.png" alt="" width={size} height={size} style={style} />
      <img className="logo logo-dark" src="/icon/dark/128.png" alt="" width={size} height={size} style={style} />
    </>
  );
}
