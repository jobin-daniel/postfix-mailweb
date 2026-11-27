import { MessageDetailClient } from "@/components/MessageDetailClient";

export default async function MessageDetailPage({
  params,
}: {
  params: Promise<{ queueId: string }>;
}) {
  const { queueId } = await params;
  const decodedId = decodeURIComponent(queueId);
  return <MessageDetailClient queueId={decodedId} />;
}
