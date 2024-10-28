<template>
  <div class="rating-review pb-5">
    <div class="flex gap-15 start align-initial block-sm">
      <div class="pr-15 pr-sm total-rating">
        <div class="pos-sticky">
          <h4 class="mb-10 bold">
            {{ $t('productReview.customerReviews') }}
          </h4>
          <div class="flex start">

            <rating-star
                class="mr-10"
              :rating="parseFloat(avgRating)"
            />
            <h4>{{ $t('ratingStar.outOf', {rating: avgRating}) }}</h4>
          </div>
          <p class="mb-15">{{ $t('productReview.peopleReviewed', {count: calculateRating.total}) }}</p>
          <div>
            <table class="mb-15">
              <tr v-for="(value, key, index) in totalRating" :key="index">
                <td>{{ $t('productReview.star', { count:key.replace('star', '') }) }}</td>
                <td>
                <span class="rating-bar mtb-5 mlr-10">
                  <span
                    :style="{width: `${calculateRatingPercent(value)}%`}"
                  />
                </span>
                </td>
                <td>{{ calculateRatingPercent(value) }}% ({{ value }})</td>
              </tr>
            </table>
          </div>
        </div>
      </div>
      <div class="all-review mlr--15">
        <div class="mlr-15">
          <div
            class="spinner-wrapper flex"
            v-if="fetchingReviews"
          >
            <spinner
              :radius="100"
            />
          </div>

          <transition name="fade" mode="out-in">
            <div
              v-if="!fetchingReviews"
              class="review-list"
            >
              <template
                v-if="currentAllReviews && currentAllReviews.length"
              >
              <div
                v-for="(value, index) in currentAllReviews"
                :key="index"
                class="mb-20 mb-sm-15"
              >
                <div class="flex start align-start gap-15">

                  <div class="user-img flex mt-5">
                    <i
                      class="icon user-icon "
                    />
                  </div>
                  <div class="flex sided grow ">
                    <div>
                      <h5
                        class="semi-bold"
                      >
                        {{ userName(value) }}
                      </h5>
                      <rating-star
                        :rating="parseFloat(value.rating)"
                      />
                    </div>
                    <p class="f-9 color-lite">{{ value.created }}</p>
                  </div>
                </div>

                <p class="mb-15"
                   v-if="!noReview(value.review)"
                >
                  {{ value.review }}
                </p>
                <div
                  v-if="value.review_images && value.review_images.length"
                  class="flex start m--5"
                >
                  <div
                    v-for="(img, i) in value.review_images"
                    :key="i"
                    class="w-70x m-5 img-wrap"
                    @click="imagePopupOpen(value, i)"
                  >
                    <div class="img-wrapper">
                      <lazy-image
                        :data-src="getThumbImageURL(img.image)"
                        :title="value.created"
                        :alt="value.created"
                        class="p-5"
                      />
                    </div>
                  </div>
                </div>
              </div>
              </template>
              <p v-else>
                {{ $t('detailRight.noReview') }}
              </p>
            </div>
          </transition>
          <pagination
            class="mb-15"
            ref="ratingPagination"
            :total-page="totalPage"
            :changing-route="false"
            @fetching-data="paginationFetch"
          />
        </div>
        <banner
          v-if="banner"
          :banner="banner"
          class="rating-banner mb-15 mlr-15"
        />
      </div>
    </div>
    <image-popup
      v-if="imagePopup"
      :active-id="activeImage"
      :image-list="reviewImages"
      @close-popup="imagePopup = false"
    />
  </div>
</template>

<script>
  import util from '~/mixin/util'
  import routeParamHelper from '~/mixin/routeParamHelper'
  import Spinner from '~/components/Spinner'
  import LazyImage from '~/components/LazyImage'
  import {mapGetters, mapActions} from 'vuex'
  import ImagePopup from '~/components/ImagePopup'
  import Pagination from '~/components/Pagination'
  import RatingStar from "~/components/RatingStar"

  export default {
    name: 'ProductReview',
    data() {
      return {
        avgRating: 0,
        totalRating: null,
        fetchingReviews: false,
        fetchingTotal: false,
        imagePopup: false,
        activeImage: 0,
        reviewImages: [],
        paginationParam: null
      }
    },
    watch: {
    },
    props: {
      id: {
        type: Number,
        required: true
      }
    },
    components: {
      RatingStar,
      Spinner,
      LazyImage,
      ImagePopup,
      Pagination
    },
    computed: {
      isSmallerDevice() {
        return window.innerWidth <= 768
      },
      calculateRating() {
        let result = {
          total: 0,
          rating: 0
        }
        this.currentTotalRating.forEach(obj => {
          this.totalRating = {...this.totalRating, ...{[`${obj.rating}star`]: obj.total}}
          result.total += parseInt(obj.total)
          result.rating += obj.total * obj.rating
        })
        this.avgRating = result.total ? this.formatPrice(result.rating / result.total) : 0
        return result
      },
      totalPage() {
        return this.allReviews?.last_page
      },
      pageCount() {
        return this.allReviews?.total
      },
      currentAllReviews() {
        return this.allReviews?.data
      },
      currentTotalRating() {
        return this.totalReviews
      },
      ...mapGetters('review', ['allReviews', 'totalReviews', 'banner']),
    },
    mixins: [util, routeParamHelper],
    methods: {
      userName(review){
        if(review?.user){
          return review?.user?.name
        } else if(review?.guest_user){
          return review?.guest_user?.name
        }
        return ""
      },
      imagePopupOpen(data, index) {
        this.reviewImages = data.review_images
        this.activeImage = index
        this.imagePopup = true
      },
      noReview(review) {
        return !review || review === 'null'
      },
      calculateRatingPercent(total) {
        return parseInt((total / this.calculateRating.total) * 100) || 0
      },
      async paginationFetch(evt) {
        this.paginationParam = evt
        await this.fetchingData()
      },
      async fetchingData() {

        this.settingParam(this.paginationParam)
        this.fetchingReviews = true
        try {
          await this.fetchReviews({
            id: this.id,
            time_zone: this.timeZone,
            order_by: this.orderBy,
            type: this.orderByType,
            get_total: !this.totalReviews.length > 0,
            page: this.page,
            q: this.search
          })

          this.$emit('has-review', this.pageCount)
        } catch (e) {
          return this.$nuxt.error(e)
        }
        this.fetchingReviews = false
      },
      ...mapActions('review', ['fetchReviews', 'emptyReviews']),
    },
    created() {
    },
    async mounted() {
      this.fetchingTotal = false
      this.emptyReviews()
      await this.fetchingData()
      this.fetchingTotal = true
      this.totalRating = {
        '5star': 0,
        '4star': 0,
        '3star': 0,
        '2star': 0,
        '1star': 0
      }
    }
  }
</script>

