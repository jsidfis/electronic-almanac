export function AlmanacStatus({ message }: { message: string }) {
  return <p className="almanac-status" role="status">{message}</p>;
}
