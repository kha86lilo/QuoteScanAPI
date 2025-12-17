'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  X,
  Mail,
  Clock,
  DollarSign,
  MapPin,
  Package,
  ChevronDown,
  ChevronUp,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  User,
  AlertCircle,
  CheckCircle2,
  Timer,
  BarChart3,
  PieChart,
  TrendingUp,
  Filter,
  MessageSquare,
} from 'lucide-react';
import {
  DashboardEmail,
  DashboardQuote,
  DashboardStaffReply,
  DashboardPricingReply,
  DashboardResponse,
  DashboardStatistics,
} from '@/types';

interface DashboardProps {
  isOpen: boolean;
  onClose: () => void;
}

// Color palette for charts
const CHART_COLORS = [
  '#3B82F6', // blue
  '#10B981', // green
  '#F59E0B', // amber
  '#EF4444', // red
  '#8B5CF6', // purple
  '#EC4899', // pink
  '#06B6D4', // cyan
  '#F97316', // orange
  '#84CC16', // lime
  '#6366F1', // indigo
];

function formatResponseTime(minutes: number | null): string {
  if (minutes === null) return 'No reply yet';
  if (minutes < 0) return 'Reply before email';
  if (minutes < 60) return `${minutes} min`;
  if (minutes < 1440) return `${Math.round(minutes / 60)} hrs`;
  return `${Math.round(minutes / 1440)} days`;
}

function getResponseTimeColor(minutes: number | null): string {
  if (minutes === null) return 'text-gray-400';
  if (minutes < 0) return 'text-gray-400';
  if (minutes <= 60) return 'text-green-600';
  if (minutes <= 240) return 'text-green-500';
  if (minutes <= 1440) return 'text-yellow-500';
  return 'text-red-500';
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '-';
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatPrice(price: number | null, currency: string | null = 'USD'): string {
  if (price === null) return '-';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency || 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(price);
}

// Simple Pie Chart Component
function SimplePieChart({
  data,
  title,
  labelKey,
  valueKey,
}: {
  data: Array<Record<string, unknown>>;
  title: string;
  labelKey: string;
  valueKey: string;
}) {
  if (!data || data.length === 0) {
    return (
      <div className="bg-white rounded-lg border border-gray-200 p-4">
        <h4 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
          <PieChart className="w-4 h-4" />
          {title}
        </h4>
        <div className="text-center text-gray-400 py-4">No data available</div>
      </div>
    );
  }

  const total = data.reduce((sum, item) => sum + (Number(item[valueKey]) || 0), 0);
  let currentAngle = 0;

  const slices = data.slice(0, 8).map((item, index) => {
    const value = Number(item[valueKey]) || 0;
    const percentage = total > 0 ? (value / total) * 100 : 0;
    const angle = (percentage / 100) * 360;
    const startAngle = currentAngle;
    currentAngle += angle;

    const startRad = (startAngle - 90) * (Math.PI / 180);
    const endRad = (startAngle + angle - 90) * (Math.PI / 180);

    const x1 = 50 + 40 * Math.cos(startRad);
    const y1 = 50 + 40 * Math.sin(startRad);
    const x2 = 50 + 40 * Math.cos(endRad);
    const y2 = 50 + 40 * Math.sin(endRad);

    const largeArc = angle > 180 ? 1 : 0;

    const pathD =
      angle >= 359.9
        ? `M 50 10 A 40 40 0 1 1 49.99 10 Z`
        : `M 50 50 L ${x1} ${y1} A 40 40 0 ${largeArc} 1 ${x2} ${y2} Z`;

    return {
      path: pathD,
      color: CHART_COLORS[index % CHART_COLORS.length],
      label: String(item[labelKey] || 'Unknown'),
      value,
      percentage,
    };
  });

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4">
      <h4 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
        <PieChart className="w-4 h-4" />
        {title}
      </h4>
      <div className="flex items-start gap-4">
        <svg viewBox="0 0 100 100" className="w-28 h-28 flex-shrink-0">
          {slices.map((slice, i) => (
            <path key={i} d={slice.path} fill={slice.color} className="hover:opacity-80 transition-opacity" />
          ))}
        </svg>
        <div className="flex-1 space-y-1 text-xs max-h-28 overflow-y-auto">
          {slices.map((slice, i) => (
            <div key={i} className="flex items-center gap-2">
              <div className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ backgroundColor: slice.color }} />
              <span className="text-gray-600 truncate flex-1" title={slice.label}>
                {slice.label}
              </span>
              <span className="text-gray-500 flex-shrink-0">{slice.percentage.toFixed(0)}%</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// Simple Bar Chart Component
function SimpleBarChart({
  data,
  title,
  labelKey,
  valueKey,
  color = '#3B82F6',
}: {
  data: Array<Record<string, unknown>>;
  title: string;
  labelKey: string;
  valueKey: string;
  color?: string;
}) {
  if (!data || data.length === 0) {
    return (
      <div className="bg-white rounded-lg border border-gray-200 p-4">
        <h4 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
          <BarChart3 className="w-4 h-4" />
          {title}
        </h4>
        <div className="text-center text-gray-400 py-4">No data available</div>
      </div>
    );
  }

  const maxValue = Math.max(...data.map((item) => Number(item[valueKey]) || 0));

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4">
      <h4 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
        <BarChart3 className="w-4 h-4" />
        {title}
      </h4>
      <div className="space-y-2">
        {data.slice(0, 6).map((item, i) => {
          const value = Number(item[valueKey]) || 0;
          const width = maxValue > 0 ? (value / maxValue) * 100 : 0;
          return (
            <div key={i} className="flex items-center gap-2 text-xs">
              <span className="w-20 text-gray-600 truncate flex-shrink-0" title={String(item[labelKey])}>
                {String(item[labelKey] || 'Unknown')}
              </span>
              <div className="flex-1 h-4 bg-gray-100 rounded overflow-hidden">
                <div
                  className="h-full rounded transition-all duration-300"
                  style={{ width: `${width}%`, backgroundColor: color }}
                />
              </div>
              <span className="w-8 text-gray-500 text-right flex-shrink-0">{value}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Statistics Cards Component
function StatisticsCards({ stats }: { stats: DashboardStatistics }) {
  const replyRate = stats.totalEmails > 0 ? ((stats.emailsWithReplies / stats.totalEmails) * 100).toFixed(1) : '0';
  const winRate = stats.totalQuotes > 0 ? ((stats.wonQuotes / stats.totalQuotes) * 100).toFixed(1) : '0';

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
      <div className="bg-white rounded-lg border border-gray-200 p-3">
        <div className="flex items-center gap-2 text-gray-500 text-xs mb-1">
          <Mail className="w-3.5 h-3.5" />
          Total Emails
        </div>
        <div className="text-2xl font-bold text-gray-900">{stats.totalEmails.toLocaleString()}</div>
        <div className="text-xs text-gray-500">{replyRate}% with replies</div>
      </div>

      <div className="bg-white rounded-lg border border-gray-200 p-3">
        <div className="flex items-center gap-2 text-gray-500 text-xs mb-1">
          <Package className="w-3.5 h-3.5" />
          Total Quotes
        </div>
        <div className="text-2xl font-bold text-gray-900">{stats.totalQuotes.toLocaleString()}</div>
        <div className="text-xs text-green-600">{winRate}% won</div>
      </div>

      <div className="bg-white rounded-lg border border-gray-200 p-3">
        <div className="flex items-center gap-2 text-gray-500 text-xs mb-1">
          <Timer className="w-3.5 h-3.5" />
          Avg Response
        </div>
        <div className="text-2xl font-bold text-gray-900">{formatResponseTime(stats.avgResponseMinutes)}</div>
        <div className="text-xs text-gray-500">{stats.totalStaffReplies.toLocaleString()} replies</div>
      </div>

      <div className="bg-white rounded-lg border border-gray-200 p-3">
        <div className="flex items-center gap-2 text-gray-500 text-xs mb-1">
          <DollarSign className="w-3.5 h-3.5" />
          Pricing Replies
        </div>
        <div className="text-2xl font-bold text-gray-900">{stats.pricingReplies.toLocaleString()}</div>
        <div className="text-xs text-gray-500">quotes sent</div>
      </div>
    </div>
  );
}

// Charts Section Component
function ChartsSection({ stats }: { stats: DashboardStatistics }) {
  // Prepare quote status data for pie chart
  const quoteStatusData = [
    { status: 'Pending', count: stats.pendingQuotes },
    { status: 'Approved', count: stats.approvedQuotes },
    { status: 'Rejected', count: stats.rejectedQuotes },
    { status: 'Won', count: stats.wonQuotes },
  ].filter((d) => d.count > 0);

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
      <SimplePieChart
        data={quoteStatusData}
        title="Quote Status"
        labelKey="status"
        valueKey="count"
      />
      <SimplePieChart
        data={stats.serviceTypeDistribution}
        title="Service Types"
        labelKey="service_type"
        valueKey="count"
      />
      <SimpleBarChart
        data={stats.responseTimeDistribution}
        title="Response Time"
        labelKey="range"
        valueKey="count"
        color="#10B981"
      />
      <SimpleBarChart
        data={stats.topSenders?.slice(0, 5) || []}
        title="Top Senders"
        labelKey="email_sender_name"
        valueKey="count"
        color="#8B5CF6"
      />
    </div>
  );
}

// Email Row Component
function EmailRow({ email }: { email: DashboardEmail }) {
  const [isExpanded, setIsExpanded] = useState(false);

  const quotes = email.quotes || [];
  const staffReplies = email.staff_replies || [];
  const hasReplies = staffReplies.length > 0;
  const hasPricing = staffReplies.some(
    (r) => r.pricing_replies && r.pricing_replies.some((p) => p.is_pricing_email && p.quoted_price)
  );

  return (
    <div className="border-b border-gray-200 last:border-b-0">
      <div
        className={`p-3 hover:bg-gray-50 cursor-pointer transition-colors ${isExpanded ? 'bg-gray-50' : ''}`}
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="flex items-start gap-3">
          <div className="flex-shrink-0 mt-1">
            {isExpanded ? (
              <ChevronUp className="w-4 h-4 text-gray-400" />
            ) : (
              <ChevronDown className="w-4 h-4 text-gray-400" />
            )}
          </div>

          <div className="flex-shrink-0 w-40">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-full bg-outlook-blue flex items-center justify-center text-white text-xs font-medium">
                {email.email_sender_name?.charAt(0)?.toUpperCase() || '?'}
              </div>
              <div className="min-w-0">
                <div className="font-medium text-gray-900 truncate text-xs">
                  {email.email_sender_name || 'Unknown'}
                </div>
                <div className="text-[10px] text-gray-500 truncate">{email.email_sender_email}</div>
              </div>
            </div>
          </div>

          <div className="flex-1 min-w-0">
            <div className="font-medium text-gray-900 truncate text-xs">{email.email_subject}</div>
            <div className="text-[10px] text-gray-500 truncate mt-0.5">{email.email_body_preview}</div>
          </div>

          <div className="flex-shrink-0 flex items-center gap-2">
            <div className="flex items-center gap-1 text-[10px]">
              <Package className="w-3 h-3 text-gray-400" />
              <span className="text-gray-600">{quotes.length}</span>
            </div>

            <div className="flex items-center gap-1 text-[10px]">
              {hasReplies ? (
                <CheckCircle2 className="w-3 h-3 text-green-500" />
              ) : (
                <AlertCircle className="w-3 h-3 text-yellow-500" />
              )}
              <span className={hasReplies ? 'text-green-600' : 'text-yellow-600'}>{staffReplies.length}</span>
            </div>

            {hasPricing && (
              <div className="flex items-center gap-1 text-[10px]">
                <DollarSign className="w-3 h-3 text-blue-500" />
              </div>
            )}

            <div className={`flex items-center gap-1 text-[10px] font-medium ${getResponseTimeColor(email.response_time_minutes)}`}>
              <Timer className="w-3 h-3" />
              <span>{formatResponseTime(email.response_time_minutes)}</span>
            </div>

            <div className="text-[10px] text-gray-500 w-24 text-right">{formatDate(email.email_received_date)}</div>
          </div>
        </div>
      </div>

      {isExpanded && (
        <div className="px-3 pb-3 bg-gray-50">
          <div className="ml-7 space-y-3">
            {quotes.length > 0 && (
              <div className="bg-white rounded-lg border border-gray-200 p-2">
                <h4 className="text-[10px] font-semibold text-gray-700 mb-1.5 flex items-center gap-1">
                  <Package className="w-3 h-3" />
                  Quote Requests ({quotes.length})
                </h4>
                <div className="space-y-1.5">
                  {quotes.map((quote: DashboardQuote) => (
                    <QuoteCard key={quote.quote_id} quote={quote} />
                  ))}
                </div>
              </div>
            )}

            {staffReplies.length > 0 && (
              <div className="bg-white rounded-lg border border-gray-200 p-2">
                <h4 className="text-[10px] font-semibold text-gray-700 mb-1.5 flex items-center gap-1">
                  <Mail className="w-3 h-3" />
                  Staff Replies ({staffReplies.length})
                </h4>
                <div className="space-y-2">
                  {staffReplies.map((reply: DashboardStaffReply) => (
                    <StaffReplyCard key={reply.reply_id} reply={reply} originalEmailDate={email.email_received_date} />
                  ))}
                </div>
              </div>
            )}

            {staffReplies.length === 0 && (
              <div className="text-center py-3 text-xs text-gray-500">
                <AlertCircle className="w-4 h-4 mx-auto mb-1 text-yellow-500" />
                No staff replies recorded
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// Quote Card Component
function QuoteCard({ quote }: { quote: DashboardQuote }) {
  return (
    <div className="text-[10px] bg-gray-50 rounded p-1.5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 space-y-0.5">
          {quote.client_company_name && (
            <div className="flex items-center gap-1 text-gray-700">
              <User className="w-2.5 h-2.5" />
              <span className="font-medium">{quote.client_company_name}</span>
            </div>
          )}
          <div className="flex items-center gap-1 text-gray-600">
            <MapPin className="w-2.5 h-2.5" />
            <span>
              {quote.origin_city || '?'}, {quote.origin_country || '?'} → {quote.destination_city || '?'},{' '}
              {quote.destination_country || '?'}
            </span>
          </div>
        </div>
        <div className="text-right space-y-0.5">
          {quote.service_type && <div className="text-gray-600">{quote.service_type}</div>}
          {quote.quote_status && (
            <span
              className={`inline-block px-1 py-0.5 rounded text-[9px] font-medium ${
                quote.quote_status === 'Approved'
                  ? 'bg-green-100 text-green-700'
                  : quote.quote_status === 'Pending'
                    ? 'bg-yellow-100 text-yellow-700'
                    : 'bg-gray-100 text-gray-700'
              }`}
            >
              {quote.quote_status}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

// Staff Reply Card Component
function StaffReplyCard({ reply, originalEmailDate }: { reply: DashboardStaffReply; originalEmailDate: string }) {
  const pricingReplies = reply.pricing_replies || [];
  const actualPricing = pricingReplies.filter((p) => p.is_pricing_email && p.quoted_price);

  const replyDate = reply.staff_received_date ? new Date(reply.staff_received_date) : null;
  const emailDate = new Date(originalEmailDate);
  const responseMinutes = replyDate ? Math.round((replyDate.getTime() - emailDate.getTime()) / (1000 * 60)) : null;

  return (
    <div className="text-[10px] border-l-2 border-blue-300 pl-2 py-0.5">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="font-medium text-gray-800">{reply.staff_sender_name || 'Staff'}</span>
            <span className="text-gray-400">{reply.staff_sender_email}</span>
          </div>
          {reply.staff_body_preview && (
            <div className="text-gray-500 truncate mt-0.5">{reply.staff_body_preview}</div>
          )}
        </div>
        <div className="flex-shrink-0 text-right">
          <div className="text-gray-500">{formatDate(reply.staff_received_date)}</div>
          <div className={`font-medium ${getResponseTimeColor(responseMinutes)}`}>
            <Clock className="w-2.5 h-2.5 inline mr-0.5" />
            {formatResponseTime(responseMinutes)}
          </div>
        </div>
      </div>

      {actualPricing.length > 0 && (
        <div className="mt-1.5 space-y-1">
          {actualPricing.map((pricing: DashboardPricingReply) => (
            <div key={pricing.staff_quote_reply_id} className="bg-blue-50 rounded p-1.5 border border-blue-100">
              <div className="flex items-start justify-between gap-2">
                <div className="space-y-0.5">
                  <div className="font-semibold text-blue-900">
                    {formatPrice(pricing.quoted_price, pricing.currency)}
                    {pricing.price_type && <span className="font-normal text-blue-600 ml-1">({pricing.price_type})</span>}
                  </div>
                  {(pricing.origin || pricing.destination) && (
                    <div className="text-blue-700">
                      <MapPin className="w-2.5 h-2.5 inline mr-0.5" />
                      {pricing.origin || '?'} → {pricing.destination || '?'}
                    </div>
                  )}
                </div>
                <div className="text-right">
                  {pricing.transit_time && <div className="text-blue-500">Transit: {pricing.transit_time}</div>}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Pagination Component
function Pagination({
  currentPage,
  totalPages,
  totalCount,
  onPageChange,
}: {
  currentPage: number;
  totalPages: number;
  totalCount: number;
  onPageChange: (page: number) => void;
}) {
  return (
    <div className="flex items-center justify-between px-4 py-2 bg-white border-t border-gray-200">
      <div className="text-xs text-gray-500">
        Page {currentPage} of {totalPages} ({totalCount.toLocaleString()} emails)
      </div>
      <div className="flex items-center gap-1">
        <button
          onClick={() => onPageChange(1)}
          disabled={currentPage <= 1}
          className="p-1 rounded hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed"
        >
          <ChevronsLeft className="w-4 h-4" />
        </button>
        <button
          onClick={() => onPageChange(currentPage - 1)}
          disabled={currentPage <= 1}
          className="p-1 rounded hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
        <div className="flex items-center gap-1 mx-2">
          {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
            let pageNum;
            if (totalPages <= 5) {
              pageNum = i + 1;
            } else if (currentPage <= 3) {
              pageNum = i + 1;
            } else if (currentPage >= totalPages - 2) {
              pageNum = totalPages - 4 + i;
            } else {
              pageNum = currentPage - 2 + i;
            }
            return (
              <button
                key={pageNum}
                onClick={() => onPageChange(pageNum)}
                className={`w-7 h-7 text-xs rounded ${
                  pageNum === currentPage
                    ? 'bg-outlook-blue text-white'
                    : 'hover:bg-gray-100 text-gray-600'
                }`}
              >
                {pageNum}
              </button>
            );
          })}
        </div>
        <button
          onClick={() => onPageChange(currentPage + 1)}
          disabled={currentPage >= totalPages}
          className="p-1 rounded hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
        <button
          onClick={() => onPageChange(totalPages)}
          disabled={currentPage >= totalPages}
          className="p-1 rounded hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed"
        >
          <ChevronsRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

// Main Dashboard Component
export default function Dashboard({ isOpen, onClose }: DashboardProps) {
  const [emails, setEmails] = useState<DashboardEmail[]>([]);
  const [statistics, setStatistics] = useState<DashboardStatistics | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pagination, setPagination] = useState({
    currentPage: 1,
    totalPages: 1,
    totalCount: 0,
    limit: 20,
  });
  const [showCharts, setShowCharts] = useState(true);
  const [filterWithReplies, setFilterWithReplies] = useState(false);

  const fetchData = useCallback(async (page: number = 1, withReplies: boolean = false) => {
    setIsLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        page: String(page),
        limit: '20',
      });
      if (withReplies) {
        params.set('withReplies', 'true');
      }
      const response = await fetch(`/api/dashboard?${params}`);
      if (!response.ok) throw new Error('Failed to fetch dashboard data');
      const data: DashboardResponse = await response.json();
      setEmails(data.emails);
      setStatistics(data.statistics);
      setPagination({
        currentPage: data.currentPage,
        totalPages: data.totalPages,
        totalCount: data.totalCount,
        limit: data.limit,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load dashboard');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      fetchData(1, filterWithReplies);
    }
  }, [isOpen, fetchData, filterWithReplies]);

  const handlePageChange = (page: number) => {
    if (page >= 1 && page <= pagination.totalPages) {
      fetchData(page, filterWithReplies);
    }
  };

  const handleFilterToggle = () => {
    const newFilter = !filterWithReplies;
    setFilterWithReplies(newFilter);
    fetchData(1, newFilter);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 overflow-hidden">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />

      <div className="absolute inset-y-0 right-0 w-full max-w-6xl bg-gray-50 shadow-xl flex flex-col">
        {/* Header */}
        <div className="flex-shrink-0 bg-outlook-blue text-white px-4 py-3 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold">Email & Quote Dashboard</h2>
            <p className="text-xs text-blue-100">Overview of shipping emails, quotes, and staff responses</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleFilterToggle}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-sm transition-colors ${
                filterWithReplies ? 'bg-green-500/80 hover:bg-green-500' : 'bg-white/10 hover:bg-white/15'
              }`}
            >
              <MessageSquare className="w-4 h-4" />
              {filterWithReplies ? 'With Replies' : 'All Emails'}
            </button>
            <button
              onClick={() => setShowCharts(!showCharts)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-sm transition-colors ${
                showCharts ? 'bg-white/20' : 'bg-white/10 hover:bg-white/15'
              }`}
            >
              <TrendingUp className="w-4 h-4" />
              {showCharts ? 'Hide Charts' : 'Show Charts'}
            </button>
            <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-lg transition-colors">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto p-4">
          {isLoading && !statistics ? (
            <div className="flex items-center justify-center h-64">
              <div className="text-center">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-outlook-blue mx-auto mb-3"></div>
                <p className="text-sm text-gray-500">Loading dashboard data...</p>
              </div>
            </div>
          ) : error ? (
            <div className="flex items-center justify-center h-64">
              <div className="text-center">
                <AlertCircle className="w-8 h-8 text-red-500 mx-auto mb-2" />
                <p className="text-red-600">{error}</p>
                <button onClick={() => fetchData(1)} className="mt-2 text-sm text-outlook-blue hover:underline">
                  Try again
                </button>
              </div>
            </div>
          ) : (
            <>
              {/* Statistics Cards */}
              {statistics && <StatisticsCards stats={statistics} />}

              {/* Charts */}
              {statistics && showCharts && <ChartsSection stats={statistics} />}

              {/* Email List */}
              <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
                <div className="bg-gray-50 px-4 py-2 border-b border-gray-200 flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
                    <Mail className="w-4 h-4" />
                    Emails
                    {filterWithReplies && (
                      <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full flex items-center gap-1">
                        <Filter className="w-3 h-3" />
                        With Replies Only
                      </span>
                    )}
                    {isLoading && <span className="text-xs text-gray-400">(loading...)</span>}
                  </h3>
                  <span className="text-xs text-gray-500">
                    {pagination.totalCount.toLocaleString()} {filterWithReplies ? 'replied' : 'total'}
                  </span>
                </div>
                {emails.length === 0 ? (
                  <div className="flex items-center justify-center h-32">
                    <div className="text-center">
                      <Mail className="w-6 h-6 text-gray-400 mx-auto mb-2" />
                      <p className="text-gray-500 text-sm">No emails found</p>
                    </div>
                  </div>
                ) : (
                  <div className="divide-y divide-gray-200">
                    {emails.map((email) => (
                      <EmailRow key={email.email_id} email={email} />
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        {/* Pagination */}
        {!isLoading && !error && pagination.totalPages > 1 && (
          <Pagination
            currentPage={pagination.currentPage}
            totalPages={pagination.totalPages}
            totalCount={pagination.totalCount}
            onPageChange={handlePageChange}
          />
        )}
      </div>
    </div>
  );
}
