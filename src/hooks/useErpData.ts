import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../contexts/AuthContext.tsx';
import {
  listAuditLogs,
  listCategories,
  listLocations,
  listNotifications,
  listOrgMembers,
  listProducts,
  listStockBalances,
  listStockMovements,
  listWarehouses,
} from '../services/erpService.ts';
import {
  listGoodsReceipts,
  listPurchaseOrders,
  listPurchaseRequests,
  listSupplierInvoices,
  listSuppliers,
} from '../services/purchasingService.ts';
import {
  listCustomers,
  listDeliveryNotes,
  listPayments,
  listQuotes,
  listSalesInvoices,
  listSalesOrders,
} from '../services/salesService.ts';

export function useErpData() {
  const { user, activeOrg } = useAuth();
  const orgId = activeOrg?.id ?? '';
  const uid = user?.uid ?? '';
  const enabled = Boolean(orgId && uid);
  const queryClient = useQueryClient();

  const categoriesQuery = useQuery({
    queryKey: ['erp', orgId, 'categories'],
    queryFn: () => listCategories(orgId, uid),
    enabled,
  });

  const productsQuery = useQuery({
    queryKey: ['erp', orgId, 'products'],
    queryFn: () => listProducts(orgId, uid),
    enabled,
  });

  const warehousesQuery = useQuery({
    queryKey: ['erp', orgId, 'warehouses'],
    queryFn: () => listWarehouses(orgId, uid),
    enabled,
  });

  const locationsQuery = useQuery({
    queryKey: ['erp', orgId, 'locations'],
    queryFn: () => listLocations(orgId, uid),
    enabled,
  });

  const balancesQuery = useQuery({
    queryKey: ['erp', orgId, 'stockBalances'],
    queryFn: () => listStockBalances(orgId, uid),
    enabled,
  });

  const movementsQuery = useQuery({
    queryKey: ['erp', orgId, 'stockMovements'],
    queryFn: () => listStockMovements(orgId, uid),
    enabled,
  });

  const membersQuery = useQuery({
    queryKey: ['erp', orgId, 'members'],
    queryFn: () => listOrgMembers(orgId, uid),
    enabled,
  });

  const auditLogsQuery = useQuery({
    queryKey: ['erp', orgId, 'auditLogs'],
    queryFn: () => listAuditLogs(orgId, uid),
    enabled,
  });

  const notificationsQuery = useQuery({
    queryKey: ['erp', orgId, 'notifications'],
    queryFn: () => listNotifications(orgId, uid),
    enabled,
  });

  const suppliersQuery = useQuery({
    queryKey: ['erp', orgId, 'suppliers'],
    queryFn: () => listSuppliers(orgId, uid),
    enabled,
  });

  const purchaseRequestsQuery = useQuery({
    queryKey: ['erp', orgId, 'purchaseRequests'],
    queryFn: () => listPurchaseRequests(orgId, uid),
    enabled,
  });

  const purchaseOrdersQuery = useQuery({
    queryKey: ['erp', orgId, 'purchaseOrders'],
    queryFn: () => listPurchaseOrders(orgId, uid),
    enabled,
  });

  const goodsReceiptsQuery = useQuery({
    queryKey: ['erp', orgId, 'goodsReceipts'],
    queryFn: () => listGoodsReceipts(orgId, uid),
    enabled,
  });

  const supplierInvoicesQuery = useQuery({
    queryKey: ['erp', orgId, 'supplierInvoices'],
    queryFn: () => listSupplierInvoices(orgId, uid),
    enabled,
  });

  const customersQuery = useQuery({
    queryKey: ['erp', orgId, 'customers'],
    queryFn: () => listCustomers(orgId, uid),
    enabled,
  });

  const quotesQuery = useQuery({
    queryKey: ['erp', orgId, 'quotes'],
    queryFn: () => listQuotes(orgId, uid),
    enabled,
  });

  const salesOrdersQuery = useQuery({
    queryKey: ['erp', orgId, 'salesOrders'],
    queryFn: () => listSalesOrders(orgId, uid),
    enabled,
  });

  const deliveryNotesQuery = useQuery({
    queryKey: ['erp', orgId, 'deliveryNotes'],
    queryFn: () => listDeliveryNotes(orgId, uid),
    enabled,
  });

  const salesInvoicesQuery = useQuery({
    queryKey: ['erp', orgId, 'salesInvoices'],
    queryFn: () => listSalesInvoices(orgId, uid),
    enabled,
  });

  const paymentsQuery = useQuery({
    queryKey: ['erp', orgId, 'payments'],
    queryFn: () => listPayments(orgId, uid),
    enabled,
  });

  const invalidateAll = async () => {
    await queryClient.invalidateQueries({ queryKey: ['erp', orgId] });
  };

  return {
    orgId,
    categories: categoriesQuery.data ?? [],
    products: productsQuery.data ?? [],
    warehouses: warehousesQuery.data ?? [],
    locations: locationsQuery.data ?? [],
    balances: balancesQuery.data ?? [],
    movements: movementsQuery.data ?? [],
    members: membersQuery.data ?? [],
    auditLogs: auditLogsQuery.data ?? [],
    notifications: notificationsQuery.data ?? [],
    suppliers: suppliersQuery.data ?? [],
    purchaseRequests: purchaseRequestsQuery.data ?? [],
    purchaseOrders: purchaseOrdersQuery.data ?? [],
    goodsReceipts: goodsReceiptsQuery.data ?? [],
    supplierInvoices: supplierInvoicesQuery.data ?? [],
    customers: customersQuery.data ?? [],
    quotes: quotesQuery.data ?? [],
    salesOrders: salesOrdersQuery.data ?? [],
    deliveryNotes: deliveryNotesQuery.data ?? [],
    salesInvoices: salesInvoicesQuery.data ?? [],
    payments: paymentsQuery.data ?? [],
    isLoading:
      productsQuery.isLoading ||
      warehousesQuery.isLoading ||
      balancesQuery.isLoading ||
      movementsQuery.isLoading,
    error:
      productsQuery.error ||
      warehousesQuery.error ||
      balancesQuery.error ||
      movementsQuery.error,
    invalidateAll,
  };
}
