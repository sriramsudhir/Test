<template>

  <div class="vouchers-wrapper">
    <transition name="fade" mode="out-in">
      <div
        class="spinner-wrapper flex"
        v-if="fetchingVoucherData"
      >
        <spinner
          :radius="100"
        />
      </div>
    </transition>
    <div
      v-if="voucherList && !voucherList.length"
      class="info-msg"
    >
      {{ $t('vouchers.noVoucher') }}
    </div>

    <div class="flex wrap start align-start">
      <div
        class="card p-15 pt-10 pb-5 mb-15"
        v-for="(value, index) in voucherList"
        :key="index"
      >
        <div class="flex sided gap-15">
          <h5 class="semi-bold mx-w-400x mb-5">
            {{ value.title }}
          </h5>
          <h4 class="semi-bold mb-5">
            {{ getPriceType(value) }}
          </h4>
        </div>
        <div class="flex sided f-9">
          <h6 class="semi-bold voucher mb-5">{{ value.code }}</h6>
          <button
            aria-label="submit"
            @click.prevent="copyTpClipboard(value)"
            class="lite-btn mb-5"
          >
            {{ copiedVouchedId === value.id ? $t('filter.copied') : $t('filter.copy') }}
          </button>
        </div>

        <div class="flex sided f-9 gap-15">
          <p class="mb-5 color-lite">
              <span class=" mr-5">
                {{ $t('vouchers.minSpend') }}
              </span>
            <b>
              <price-format
                :price="value.min_spend"
              />
            </b>
          </p>
          <p class="f-9 mb-5 color-danger">
              <span class="mr-5">
                {{ $t('vouchers.valid') }}
              </span>
            {{ value.end_time }}
          </p>
        </div>
      </div>
    </div>
    <div class="flow-hidden">
      <pagination
        ref="voucherPagination"
        :total-page="totalPage"
        :page="currentPage"
        :changing-route="changingRoute"
        @fetching-data="fetchingData"
      />
    </div>
  </div>

</template>

<script>
  import util from '~/mixin/util'
  import routeParamHelper from '~/mixin/routeParamHelper'
  import productHelper from '~/mixin/productHelper'
  import {mapGetters, mapActions} from 'vuex'
  import Pagination from "./Pagination";
  import Spinner from "./Spinner";
  import PriceFormat from "./PriceFormat";

  export default {
    name: 'Vouchers',
    data() {
      return {
        fetchingVoucherData: false,
        copiedVouchedId: ''
      }
    },
    watch: {},
    props: {
      changingRoute: {
        type: Boolean,
        default: true
      }
    },
    components: {
      PriceFormat,
      Spinner,
      Pagination
    },
    computed: {
      currentPage() {
        return this.vouchers?.current_page
      },
      totalPage() {
        return this.vouchers?.last_page
      },
      voucherList() {
        return this.vouchers?.data
      },
      ...mapGetters('language', ['langCode']),
      ...mapGetters('common', ['currencyIcon', 'currencyPosition', 'setting']),
      ...mapGetters('user', ['vouchers']),
    },
    mixins: [util, routeParamHelper, productHelper],
    methods: {
      copyTpClipboard(value) {
        navigator.clipboard.writeText(value.code)
        this.copiedVouchedId = value.id
      },
      loadData() {
        this.$refs.voucherPagination.routeParam()
      },
      async fetchingData() {
        this.fetchingVoucherData = true
        setTimeout(async () => {
          try {
            this.settingRouteParam()
            const data = await this.userVouchers({
              params: {
                time_zone: this.timeZone,
                order_by: this.orderBy,
                type: this.orderByType,
                page: this.page,
                q: this.search
              },
              lang: this.langCode,
            })
            if (data?.status === 201) {
              this.hasError(data)
            }
          } catch (e) {
            return this.$nuxt.error(e)
          }
          this.fetchingVoucherData = false
        }, 100)
      },
      ...mapActions('user', ['userVouchers']),
    },
    created() {
    },
    async mounted() {
      if (!this.vouchers) {
        await this.fetchingData()
      }
    }
  }
</script>

