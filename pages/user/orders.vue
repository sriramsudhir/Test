<template>
  <client-only>
    <account-layout
      active-route="orders"
      @clicked-orders="loadData"
      class="mb-5"
    >
      <template v-slot:rightArea>
        <transition name="fade" mode="out-in">
          <rate-popup
            v-if="rateProductId"
            :order-id="rateOrderId"
            :product-id="rateProductId"
            @close="rateProductId = 0"
          />
        </transition>
        <order-tabbing
          ref="orderTab"
          @fetch-data="fetchingData"
        />
        <div
          class="spinner-wrapper flex layer-white"
          v-if="fetchingOrderData"
        >
          <spinner
            :radius="100"
          />
        </div>
        <div
          v-else-if="currentOrders && !currentOrders.length"
          class="info-msg"
        >
          {{ $t('orders.noOrderYet') }}
        </div>
        <div v-else>
          <div
            v-for="(value, index) in currentOrders"
            :key="index"
            class="card mb-15"
          >
            <div class="flex sided b-b ptb-10 plr-20 plr-sm-15 block-xs">
              <div>
                <nuxt-link
                  :to="`/user/order/${value.id}`"
                  class="block"
                >
                  {{ $t('order.order') }}
                  <span class="link-color">
                  #{{ value.order }}
                </span>
                </nuxt-link>
                <span class="color-lite f-9">{{ $t('filter.placed', {date: value.created}) }}</span>
              </div>

              <div>
                <nuxt-link
                  :to="`/user/order/${value.id}`"
                  class="link-color mt-xs-5"
                >
                  {{ $t('orders.manageOrder') }}
                </nuxt-link>
              </div>
            </div>

            <div
              v-for="(ordered, i) in value.ordered_products"
              :key="i"
              class="flex sided ptb-10 plr-20 plr-sm-15"
            >
              <div class="flex grow gap-15">
                <div class="w-80x">
                  <nuxt-link
                    :to="productLink(ordered.product)"
                    class="img-wrapper w-100"
                  >
                    <lazy-image
                      :data-src="thumbImageURL(ordered.product)"
                      :title="ordered.product.title"
                      :alt="ordered.product.title"
                    />
                  </nuxt-link>
                </div>
                <div class="flex grow sided block-xs">
                  <div>
                    <h5>
                      <nuxt-link
                        :to="productLink(ordered.product)"
                        :title="ordered.product.title"
                      >
                        {{ ordered.product.title }}
                      </nuxt-link>
                    </h5>
                    <button
                      v-if="!!!value.cancelled"
                      aria-label="submit"
                      class="link-color "
                      @click.prevent="rateNow(ordered)"
                    >
                      {{ $t('ratePopup.rateNow') }}
                    </button>
                  </div>

                  <div class="flex start">
                    <h5 class="mr-20 mr-sm-15">
                    <span class="color-lite f-9 mr-5">
                      {{ $t('orders.qty') }}
                    </span>
                      {{ ordered.quantity }}
                    </h5>

                    <h5 class="">
                    <span class="color-lite f-9 mr-5">
                      {{ $t('detailRight.price') }}
                    </span>

                      <price-format
                        :price="parseInt(ordered.selling)"
                      />

                    </h5>
                  </div>
                </div>
              </div>
            </div>

            <div
              class="flex sided block-xs b-t ptb-10 plr-20 plr-sm-15 pos-rel"
            >
              <p
                v-if="parseInt(dataFromObject(value, 'cancelled', 0)) === status.PUBLIC"
                class="color-danger mr-15"
              >
                {{ $t('order.orderCancelled') }}
              </p>
              <p
                v-else
                class="mr-15"
              >
              <span
                class="color-lite f-8 mr-5"
              >
                {{ $t('orders.shippingStatus') }}
              </span>
                <span class="">
                {{ orderStatus[value.status].title }}
              </span>
              </p>
              <div class="flex sided">
                <p>
                <span
                  class="color-lite f-8 mr-5"
                >
                  {{ $t('order.paymentStatus') }}
                </span>
                  <span
                    class=" mr-5"
                  >
                  {{ paymentStatus[value.payment_done] }}
                </span>
                </p>
                <pay-button
                  v-if="parseInt(dataFromObject(value, 'cancelled', 0)) !== status.PUBLIC
                    && parseInt(value.payment_done) === paymentStatusIn.UNPAID
                    && parseInt(value.order_method) !== orderMethods.CASH_ON_DELIVERY"
                  :order="value"
                />
              </div>
            </div>
          </div>
        </div>

        <div class="flow-hidden">
          <pagination
            v-if="!changedSelectedOrder"
            ref="orderPagination"
            :total-page="totalPage"
            @fetching-data="fetchingData"
          />
        </div>
      </template>
    </account-layout>
  </client-only>

</template>

<script>
  import {mapGetters, mapActions} from 'vuex'
  import util from '~/mixin/util'
  import metaHelper from '~/mixin/metaHelper'
  import LazyImage from '~/components/LazyImage'
  import RatePopup from '~/components/RatePopup'
  import PaymentPopup from '~/components/PaymentPopup'
  import AccountLayout from '~/components/AccountLayout'
  import routeParamHelper from '~/mixin/routeParamHelper'
  import Pagination from '~/components/Pagination'
  import OrderTabbing from "~/components/OrderTabbing";
  import Spinner from "~/components/Spinner";
  import PayButton from "~/components/PayButton";
  import PriceFormat from "~/components/PriceFormat";
  import global from '~/mixin/global'

  export default {
    middleware: ['common-middleware'],
    head() {
      return {
        title: 'Orders',
        meta: []
      }
    },
    data() {
      return {
        payNowOrder: null,
        deactivate: true,
        fetchingOrderData: false,
        changedSelectedOrder: false,
        rateProductId: 0,
        rateOrderId: 0,
        orderParams: {}
      }
    },
    watch: {},
    components: {
      PriceFormat,
      PayButton,
      Spinner,
      OrderTabbing,
      LazyImage,
      RatePopup,
      AccountLayout,
      Pagination,
      PaymentPopup
    },
    mixins: [util, metaHelper, routeParamHelper, global],
    computed: {
      totalPage() {
        return this.orderedList?.last_page
      },
      currentOrders() {
        return this.orderedList?.data
      },
      ...mapGetters('language', ['langCode']),
      ...mapGetters('order', ['orderedList']),
      ...mapGetters('common', ['currencyIcon', 'setting'])
    },
    methods: {
      async generateParam() {
        this.changedSelectedOrder = true
        await this.fetchingData()
      },
      rateNow(ordered) {
        this.rateProductId = ordered.product.id
        this.rateOrderId = parseInt(ordered.order_id)
      },
      loadData() {
        this.$refs.orderPagination.routeParam()
      },
      async fetchingData() {
        this.fetchingOrderData = true
        setTimeout(async () => {
          try {
            this.settingRouteParam()
            const params = {
              ...{
                time_zone: this.timeZone,
                order_by: this.orderBy,
                type: this.orderByType,
                page: this.page,
                q: this.search,
                user_token: await this.getUserToken(),
              },
              ...this.$refs.orderTab?.generateParam()
            }
            const data = await this.getOrderByUser({
              payload: params,
              lang: this.langCode
            })
            if (data?.status !== 200) {
              this.hasError(data)
            }
          } catch (e) {
            return this.$nuxt.error(e)
          }
          this.changedSelectedOrder = false
          this.fetchingOrderData = false
        }, 100)
      },
      ...mapActions('user', ['getUserToken']),
      ...mapActions('order', ['getOrderByUser']),
    },

    async mounted(){
      await this.fetchingData()
        window.scrollTo(0,0);
    },
    async asyncData({store, error, $auth}) {
      try {

        if(!store.state?.common?.setting?.guest_checkout) {
          if (!$auth.loggedIn) {
            $auth.redirect('login')
            return false
          }
        }

        if(!store.state.common.paymentGateway){
          const data = await store.dispatch('common/getRequest', {
            params: {},
            api: 'paymentGateway'
          })

          store.commit('common/SET_PAYMENT_GATEWAY', data.data)
        }
      } catch (e) {
        error(e)
      }
    },
  }
</script>

<style>

</style>
