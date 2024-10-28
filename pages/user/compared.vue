<template>
  <account-layout
    active-route="compared"
    @clicked-compared="loadData"
    class="flow-hidden"
  >
    <template v-slot:rightArea>

      <transition name="fade" mode="out-in">
        <div
          class="spinner-wrapper flex"
          v-if="fetchingComparedData"
        >
          <spinner
            :radius="100"
          />
        </div>
      </transition>


      <div
        v-if="currentCompared && !currentCompared.length"
        class="info-msg"
      >
        {{ $t('compared.noData') }}
      </div>

      <div
        v-else
        class="area"
      >
        <div class="area-content">
          <div class="tile-container">
            <div
              class="shimmer-wrapper pt-15"
              v-if="fetchingComparedData"
            >
              <tile-shimmer
                v-for="index in 8"
                :key="index"
              />
            </div>
            <template v-else>
              <compared-tile
                v-for="(value, index) in currentCompared"
                :key="index"
                :product="value.product"
                @removed="removedSuccessfully"
              />
            </template>
          </div>
        </div>
      </div>

      <pagination
        class="mt-20 mt-sm-15"
        ref="comparedPagination"
        :total-page="totalPage"
        @fetching-data="fetchingData"
      />

    </template>
  </account-layout>
</template>

<script>

  import {mapGetters, mapActions} from 'vuex'
  import util from '~/mixin/util'
  import LazyImage from '~/components/LazyImage'
  import RatePopup from '~/components/RatePopup'
  import AccountLayout from '~/components/AccountLayout'
  import ComparedTile from '~/components/ComparedTile'
  import routeParamHelper from '~/mixin/routeParamHelper'
  import Pagination from '~/components/Pagination'
  import Spinner from "~/components/Spinner";
  import TileShimmer from "~/components/TileShimmer";
  import global from '~/mixin/global'

  export default {
    middleware: ['common-middleware', 'auth'],
    head() {
      return {
        title: 'Compared',
        meta: []
      }
    },
    data() {
      return {
        fetchingComparedData: false,
        allCompared: null,
      }
    },
    watch: {},
    components: {
      TileShimmer,
      Spinner,
      LazyImage,
      RatePopup,
      AccountLayout,
      Pagination,
      ComparedTile
    },
    mixins: [util, routeParamHelper, global],
    computed: {
      totalPage() {
        return this.allCompared?.last_page
      },
      currentCompared() {
        return this.allCompared?.data
      },
      ...mapGetters('language', ['langCode']),
    },
    methods: {
      async removedSuccessfully() {
        await this.fetchingData()
      },
      async loadData() {
        this.$refs.comparedPagination.routeParam()
      },
      async fetchingData() {
        this.fetchingComparedData = true
        setTimeout(async () => {

          try {
            this.settingRouteParam()

            const data = await this.getRequest({
              params: {
                time_zone: this.timeZone,
                order_by: this.orderBy,
                type: this.orderByType,
                page: this.page,
                q: this.search
              },
              api: 'compareListAll',
              requiredToken: true,
              lang: this.langCode,
            })

            if (data?.status !== 200) {
              this.hasError(data)
            } else if (data?.status === 200) {
              this.allCompared = data.data
            }
          } catch (e) {
            return this.$nuxt.error(e)
          }
          this.fetchingComparedData = false
        }, 100)

      },
      ...mapActions('common', ['getRequest']),
    },
    async mounted() {
      await this.fetchingData()
    },
  }
</script>

<style>

</style>
