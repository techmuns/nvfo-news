import { Inbox } from 'lucide-react';
import type { NewsItem } from '../lib/types';
import { ChartCard } from '../components/charts/ChartCard';
import { NewsflowChart } from '../components/charts/NewsflowChart';
import { TopicDonut } from '../components/charts/TopicDonut';
import { TopCompaniesBar } from '../components/charts/TopCompaniesBar';
import { MoodChart } from '../components/charts/MoodChart';
import { HighlightsStrip } from '../components/charts/HighlightsStrip';
import { EmptyState } from '../components/ui/EmptyState';

export function Pulse({ items }: { items: NewsItem[] }) {
  if (items.length === 0) {
    return (
      <EmptyState
        icon={Inbox}
        title="No news in this feed yet"
        hint="Switch feeds using the toggle above, or refresh for the latest sample data."
      />
    );
  }

  return (
    <div className="space-y-6">
      <HighlightsStrip items={items} />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ChartCard
          title="Newsflow over time"
          caption="How many stories broke each day, last 14 days"
        >
          <NewsflowChart items={items} />
        </ChartCard>

        <ChartCard
          title="What kind of news"
          caption="Every story sorted into six simple buckets"
        >
          <TopicDonut items={items} />
        </ChartCard>

        <ChartCard
          title="Most in the news"
          caption="Companies with the most stories right now"
        >
          <TopCompaniesBar items={items} />
        </ChartCard>

        <ChartCard
          title="Mood"
          caption="Is the news good, neutral, or bad?"
        >
          <MoodChart items={items} />
        </ChartCard>
      </div>
    </div>
  );
}
